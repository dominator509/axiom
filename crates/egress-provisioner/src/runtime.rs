use crate::{
    namespace_for, validate_request, Action, BindingInfo, BindingPolicy, ProvisionError, Request,
    Response,
};
use egress_plane::{
    config::{EgressMode, NetworkConfig},
    netns, proxy, tunnel,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

const SIDECAR_PORT: u16 = 8080;
const STATE_VERSION: u8 = 1;
const PRODUCTION_STATE_FILE: &str = "/run/axiom/egress/provisioner-state.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SidecarLaunchMode {
    Systemd,
    IsolatedDirect,
}

#[derive(Clone)]
pub struct RuntimeSettings {
    sidecar_bin: PathBuf,
    sidecar_uid: u32,
    sidecar_gid: u32,
    state_file: PathBuf,
    launch_mode: SidecarLaunchMode,
}

impl std::fmt::Debug for RuntimeSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeSettings")
            .field("sidecar_bin", &self.sidecar_bin)
            .field("sidecar_uid", &self.sidecar_uid)
            .field("sidecar_gid", &self.sidecar_gid)
            .field("state_file", &self.state_file)
            .field("launch_mode", &self.launch_mode)
            .finish()
    }
}

impl RuntimeSettings {
    pub fn from_env() -> io::Result<Self> {
        let sidecar_bin = env_path("AXIOM_EGRESS_SIDECAR_BIN")?;
        let metadata = fs::metadata(&sidecar_bin)?;
        if !metadata.is_file() {
            return Err(io::Error::other(
                "AXIOM_EGRESS_SIDECAR_BIN must name a regular file",
            ));
        }
        let state_file = std::env::var_os("AXIOM_EGRESS_STATE_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(PRODUCTION_STATE_FILE));
        if !state_file.is_absolute() {
            return Err(io::Error::other(
                "AXIOM_EGRESS_STATE_FILE must be an absolute path",
            ));
        }
        let launch_mode = match std::env::var("AXIOM_EGRESS_RUNTIME_MODE").as_deref() {
            Ok("systemd") => SidecarLaunchMode::Systemd,
            Ok("isolated-direct")
                if std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref() == Ok("1") =>
            {
                SidecarLaunchMode::IsolatedDirect
            }
            _ => {
                return Err(io::Error::other(
                    "AXIOM_EGRESS_RUNTIME_MODE must be systemd; isolated-direct is test-only",
                ))
            }
        };
        let (sidecar_uid, sidecar_gid) = if launch_mode == SidecarLaunchMode::IsolatedDirect {
            (
                parse_non_root_id("AXIOM_EGRESS_SIDECAR_UID")?,
                parse_non_root_id("AXIOM_EGRESS_SIDECAR_GID")?,
            )
        } else {
            (0, 0)
        };
        Ok(Self {
            sidecar_bin,
            sidecar_uid,
            sidecar_gid,
            state_file,
            launch_mode,
        })
    }

    #[cfg(test)]
    pub(crate) fn for_isolated_test(sidecar_bin: PathBuf, state_file: PathBuf) -> Self {
        Self {
            sidecar_bin,
            sidecar_uid: 65534,
            sidecar_gid: 65534,
            state_file,
            launch_mode: SidecarLaunchMode::IsolatedDirect,
        }
    }

    fn environment_file(&self, model_id: &str) -> PathBuf {
        self.state_file
            .parent()
            .unwrap_or_else(|| Path::new("/run/axiom/egress"))
            .join(format!("sidecar-{model_id}.env"))
    }
}

fn env_path(name: &str) -> io::Result<PathBuf> {
    let value =
        std::env::var_os(name).ok_or_else(|| io::Error::other(format!("{name} is required")))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(io::Error::other(format!("{name} must be an absolute path")));
    }
    Ok(path)
}

fn parse_non_root_id(name: &str) -> io::Result<u32> {
    let value = std::env::var(name).map_err(|_| io::Error::other(format!("{name} is required")))?;
    let parsed = value
        .parse::<u32>()
        .map_err(|_| io::Error::other(format!("{name} must be numeric")))?;
    if parsed == 0 {
        return Err(io::Error::other(format!("{name} must be non-root")));
    }
    Ok(parsed)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeManifest {
    version: u8,
    managed_models: Vec<String>,
}

impl Default for RuntimeManifest {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            managed_models: Vec::new(),
        }
    }
}

struct ActiveBinding {
    info: BindingInfo,
    mode: EgressMode,
    child: Option<Child>,
}

enum BindFailure {
    BeforeNamespace(ProvisionError),
    AfterNamespace(ProvisionError),
}

#[derive(Default)]
struct RuntimeState {
    managed_models: HashSet<String>,
    active: HashMap<String, ActiveBinding>,
}

pub struct ProvisionerRuntime {
    settings: RuntimeSettings,
    state: Mutex<RuntimeState>,
}

impl std::fmt::Debug for ProvisionerRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProvisionerRuntime")
            .field("settings", &self.settings)
            .finish_non_exhaustive()
    }
}

impl ProvisionerRuntime {
    /// Enforce fail-closed egress when a model sidecar exits or cannot be
    /// verified. The weak reference lets the monitor stop with its server.
    pub fn start_sidecar_watchdog(runtime: &Arc<Self>) -> io::Result<JoinHandle<()>> {
        let runtime: Weak<Self> = Arc::downgrade(runtime);
        std::thread::Builder::new()
            .name("axiom-egress-watchdog".to_string())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let Some(runtime) = runtime.upgrade() else {
                    break;
                };
                runtime.fail_closed_inactive_sidecars();
            })
    }

    fn fail_closed_inactive_sidecars(&self) {
        let inactive_models = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            state
                .active
                .iter_mut()
                .filter_map(|(model_id, active)| {
                    let running = match active.child.as_mut() {
                        Some(child) => child
                            .try_wait()
                            .map(|status| status.is_none())
                            .unwrap_or(false),
                        None => systemd_unit_active(&sidecar_unit(model_id)).unwrap_or(false),
                    };
                    (!running).then(|| model_id.clone())
                })
                .collect::<Vec<_>>()
        };
        for model_id in inactive_models {
            let Ok(namespace) = namespace_for(&model_id) else {
                continue;
            };
            if let Err(error) = netns::flush_allow_rules(&namespace) {
                tracing::error!(model_id = %model_id, %error, "failed to close egress for inactive sidecar");
            }
        }
    }

    /// Load the private resource manifest and remove only the exact namespace,
    /// veth and systemd instances previously created by this provisioner.
    /// A malformed manifest fails startup instead of sweeping host resources.
    pub fn new(settings: RuntimeSettings) -> io::Result<Self> {
        let parent = settings
            .state_file
            .parent()
            .ok_or_else(|| io::Error::other("runtime state file requires a parent directory"))?;
        fs::create_dir_all(parent)?;
        let managed_models = read_manifest(&settings.state_file)?;
        let runtime = Self {
            settings,
            state: Mutex::new(RuntimeState {
                managed_models,
                active: HashMap::new(),
            }),
        };
        runtime.recover_managed_resources()?;
        Ok(runtime)
    }

    pub fn apply(
        &self,
        request: &Request,
        key: &[u8],
        now: u64,
    ) -> Result<Response, ProvisionError> {
        let mode = validate_request(request, key, now)?;
        if mode == EgressMode::Direct {
            return Err(ProvisionError::Invalid(
                "direct mode does not have a provisioned namespace".to_string(),
            ));
        }
        let namespace = namespace_for(&request.lease.model_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| ProvisionError::Invalid("provisioner state unavailable".to_string()))?;
        match request.action {
            Action::Create => self.create(&mut state, request, mode, namespace),
            Action::Bind => self.bind(&mut state, request, mode, namespace),
            Action::Inspect => self.inspect(&mut state, request, mode, namespace),
            Action::Release => self.release(&mut state, request, mode, namespace),
        }
    }

    fn create(
        &self,
        state: &mut RuntimeState,
        request: &Request,
        mode: EgressMode,
        namespace: String,
    ) -> Result<Response, ProvisionError> {
        if state.managed_models.contains(&request.lease.model_id) {
            return Err(ProvisionError::Invalid(
                "model namespace is already managed".to_string(),
            ));
        }
        if netns::namespace_exists(&namespace).map_err(ProvisionError::Netns)? {
            return Err(ProvisionError::Invalid(
                "model namespace exists outside the provisioner manifest".to_string(),
            ));
        }
        self.track_model(state, &request.lease.model_id)?;
        match create_default_deny_namespace(&namespace) {
            Ok(()) => {}
            Err(BindFailure::BeforeNamespace(error)) => {
                state.managed_models.remove(&request.lease.model_id);
                Self::persist_to(&self.settings, state)?;
                return Err(error);
            }
            Err(BindFailure::AfterNamespace(error)) => {
                self.cleanup_failed_bind(state, &request.lease.model_id, &namespace)?;
                return Err(error);
            }
        }
        Ok(response(request, mode, namespace, "created", None))
    }

    fn bind(
        &self,
        state: &mut RuntimeState,
        request: &Request,
        mode: EgressMode,
        namespace: String,
    ) -> Result<Response, ProvisionError> {
        let binding = request
            .binding
            .as_ref()
            .ok_or_else(|| ProvisionError::Invalid("bind policy is required".to_string()))?;
        if state.managed_models.contains(&request.lease.model_id) {
            self.release_model(state, &request.lease.model_id, &namespace)?;
        }
        let veth_host = netns::veth_host_name(&namespace);
        if netns::namespace_exists(&namespace).map_err(ProvisionError::Netns)?
            || netns::host_link_exists(&veth_host).map_err(ProvisionError::Netns)?
        {
            return Err(ProvisionError::Invalid(
                "model egress resources exist outside the provisioner manifest".to_string(),
            ));
        }
        self.track_model(state, &request.lease.model_id)?;

        let outcome = self.bind_resources(&request.lease.model_id, &namespace, mode, binding);
        let (info, child) = match outcome {
            Ok(resources) => resources,
            Err(BindFailure::BeforeNamespace(error)) => {
                state.managed_models.remove(&request.lease.model_id);
                Self::persist_to(&self.settings, state)?;
                return Err(error);
            }
            Err(BindFailure::AfterNamespace(error)) => {
                self.cleanup_failed_bind(state, &request.lease.model_id, &namespace)?;
                return Err(error);
            }
        };
        state.active.insert(
            request.lease.model_id.clone(),
            ActiveBinding {
                info: info.clone(),
                mode,
                child,
            },
        );
        Self::persist_to(&self.settings, state)?;
        Ok(response(request, mode, namespace, "bound", Some(info)))
    }

    fn bind_resources(
        &self,
        model_id: &str,
        namespace: &str,
        mode: EgressMode,
        binding: &BindingPolicy,
    ) -> Result<(BindingInfo, Option<Child>), BindFailure> {
        let octet = binding.subnet_octet;
        let host_address = format!("10.240.{octet}.1/30");
        let ns_address = format!("10.240.{octet}.2/30");
        let ns_ip = format!("10.240.{octet}.2");
        let gateway = format!("10.240.{octet}.1");

        netns::create_netns(namespace)
            .map_err(|error| BindFailure::BeforeNamespace(error.into()))?;
        let result = (|| -> Result<(BindingInfo, Option<Child>), ProvisionError> {
            netns::set_null_default_route(namespace)?;
            netns::configure_firewall(namespace, &gateway, SIDECAR_PORT)?;
            let veth_host = netns::setup_veth(namespace, &host_address, &ns_address)?;
            let (upstream, upstream_connect_addr) = match mode {
                EgressMode::Socks5 | EgressMode::Http | EgressMode::Https => {
                    let proxy_addr = binding.proxy_addr.as_deref().ok_or_else(|| {
                        ProvisionError::Invalid("proxy address is required".to_string())
                    })?;
                    let endpoint = binding
                        .proxy_connect_addr
                        .as_deref()
                        .and_then(|value| value.parse().ok())
                        .ok_or_else(|| {
                            ProvisionError::Invalid(
                                "resolved proxy endpoint is required".to_string(),
                            )
                        })?;
                    netns::allow_endpoint(namespace, &gateway, endpoint, "tcp")?;
                    let kind = match mode {
                        EgressMode::Socks5 => proxy::ProxyKind::Socks5,
                        EgressMode::Https => proxy::ProxyKind::Https,
                        _ => proxy::ProxyKind::Http,
                    };
                    (
                        proxy::Upstream::Proxy {
                            kind,
                            addr: proxy_addr.to_string(),
                            connect_addr: Some(endpoint),
                            username: binding.proxy_username.clone(),
                            password: binding.proxy_password.clone(),
                        },
                        Some(endpoint.to_string()),
                    )
                }
                EgressMode::WireGuard | EgressMode::Vpn => {
                    let config = NetworkConfig {
                        model_id: model_id.to_string(),
                        org_id: String::new(),
                        mode,
                        proxy_addr: None,
                        wg_public_key: binding.wg_public_key.clone(),
                        wg_endpoint: binding.wg_endpoint.clone(),
                        wg_allowed_ips: binding.wg_allowed_ips.clone(),
                        wg_persistent_keepalive: binding.wg_persistent_keepalive,
                        expected_egress_ip: None,
                        failover_proxy_addrs: Vec::new(),
                        enc_creds: None,
                        enc_nonce: None,
                        dek_id: None,
                    };
                    let private_key = binding.wg_private_key.as_deref().ok_or_else(|| {
                        ProvisionError::Invalid("tunnel private key is required".to_string())
                    })?;
                    let iface_address = binding.iface_addr.as_deref().unwrap_or("10.7.0.2/32");
                    let spec = tunnel::TunnelSpec::from_config(&config, private_key, iface_address)
                        .map_err(ProvisionError::Invalid)?;
                    let endpoint = spec.endpoint.parse().map_err(|_| {
                        ProvisionError::Invalid("resolved tunnel endpoint is required".to_string())
                    })?;
                    netns::allow_endpoint(namespace, &gateway, endpoint, "udp")?;
                    tunnel::bring_up_tunnel(
                        namespace,
                        &spec,
                        private_key,
                        binding.wg_preshared_key.as_deref(),
                    )?;
                    netns::allow_tunnel(namespace)?;
                    (proxy::Upstream::Direct, None)
                }
                EgressMode::Direct => {
                    return Err(ProvisionError::Invalid(
                        "direct mode cannot be provisioned".to_string(),
                    ));
                }
            };

            let listen: SocketAddr = format!("{ns_ip}:{SIDECAR_PORT}").parse().map_err(|_| {
                ProvisionError::Invalid("invalid sidecar listen address".to_string())
            })?;
            let mut child = self.start_sidecar(model_id, namespace, listen, &upstream)?;
            if let Err(error) = wait_for_sidecar(listen) {
                if let Some(child) = child.as_mut() {
                    let _ = stop_child(child);
                }
                return Err(error.into());
            }
            let info = BindingInfo {
                host_ip: ns_ip.clone(),
                ns_ip,
                veth_host,
                tunnel_handshake: mode.is_tunnel() && tunnel::tunnel_has_handshake(namespace),
                upstream_connect_addr,
            };
            drop(upstream);
            Ok((info, child))
        })();
        result.map_err(BindFailure::AfterNamespace)
    }

    fn start_sidecar(
        &self,
        model_id: &str,
        namespace: &str,
        listen: SocketAddr,
        upstream: &proxy::Upstream,
    ) -> io::Result<Option<Child>> {
        match self.settings.launch_mode {
            SidecarLaunchMode::IsolatedDirect => proxy::spawn_sidecar_in_netns_as(
                namespace,
                &self.settings.sidecar_bin,
                &listen.ip().to_string(),
                listen.port(),
                upstream,
                self.settings.sidecar_uid,
                self.settings.sidecar_gid,
            )
            .map(Some),
            SidecarLaunchMode::Systemd => {
                self.start_systemd_sidecar(model_id, listen, upstream)?;
                Ok(None)
            }
        }
    }

    fn start_systemd_sidecar(
        &self,
        model_id: &str,
        listen: SocketAddr,
        upstream: &proxy::Upstream,
    ) -> io::Result<()> {
        let path = self.settings.environment_file(model_id);
        let mut encoded = Zeroizing::new(proxy::encode_sidecar_config(listen, upstream)?);
        let mut file = private_new_file(&path)?;
        file.write_all(b"SIDECAR_CONFIG_B64=")?;
        file.write_all(encoded.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        encoded.zeroize();
        drop(file);
        let unit = sidecar_unit(model_id);
        let start = systemctl(&["start", &unit]);
        let remove_result = fs::remove_file(&path);
        if !start? {
            return Err(io::Error::other("sidecar systemd unit did not start"));
        }
        remove_result?;
        Ok(())
    }

    fn inspect(
        &self,
        state: &mut RuntimeState,
        request: &Request,
        mode: EgressMode,
        namespace: String,
    ) -> Result<Response, ProvisionError> {
        inspect_default_deny_namespace(&namespace)?;
        let info = if let Some(active) = state.active.get_mut(&request.lease.model_id) {
            if active.mode != mode {
                return Err(ProvisionError::Invalid(
                    "requested mode does not match the managed binding".to_string(),
                ));
            }
            let running = match active.child.as_mut() {
                Some(child) => child.try_wait().map_err(ProvisionError::Netns)?.is_none(),
                None => systemd_unit_active(&sidecar_unit(&request.lease.model_id))
                    .map_err(ProvisionError::Netns)?,
            };
            if !running {
                let _ = netns::flush_allow_rules(&namespace);
                return Err(ProvisionError::Invalid(
                    "sidecar is not running; model egress was closed".to_string(),
                ));
            }
            Some(active.info.clone())
        } else {
            None
        };
        Ok(response(request, mode, namespace, "ready", info))
    }

    fn release(
        &self,
        state: &mut RuntimeState,
        request: &Request,
        mode: EgressMode,
        namespace: String,
    ) -> Result<Response, ProvisionError> {
        if state.managed_models.contains(&request.lease.model_id) {
            self.release_model(state, &request.lease.model_id, &namespace)?;
        }
        Ok(response(request, mode, namespace, "released", None))
    }

    fn track_model(&self, state: &mut RuntimeState, model_id: &str) -> Result<(), ProvisionError> {
        state.managed_models.insert(model_id.to_string());
        Self::persist_to(&self.settings, state).map_err(ProvisionError::Netns)
    }

    fn cleanup_failed_bind(
        &self,
        state: &mut RuntimeState,
        model_id: &str,
        namespace: &str,
    ) -> Result<(), ProvisionError> {
        let cleanup = Self::cleanup_kernel_resources(&self.settings, model_id, namespace);
        if cleanup.is_ok() {
            state.active.remove(model_id);
            state.managed_models.remove(model_id);
            Self::persist_to(&self.settings, state)?;
        }
        cleanup.map_err(ProvisionError::Netns)
    }

    fn release_model(
        &self,
        state: &mut RuntimeState,
        model_id: &str,
        namespace: &str,
    ) -> Result<(), ProvisionError> {
        if let Some(active) = state.active.get_mut(model_id) {
            if let Some(child) = active.child.as_mut() {
                stop_child(child).map_err(ProvisionError::Netns)?;
            }
        }
        state.active.remove(model_id);
        Self::cleanup_kernel_resources(&self.settings, model_id, namespace)?;
        state.managed_models.remove(model_id);
        Self::persist_to(&self.settings, state)?;
        Ok(())
    }

    fn cleanup_kernel_resources(
        settings: &RuntimeSettings,
        model_id: &str,
        namespace: &str,
    ) -> io::Result<()> {
        match settings.launch_mode {
            SidecarLaunchMode::Systemd => {
                stop_systemd_unit(&runner_unit(model_id))?;
                stop_systemd_unit(&sidecar_unit(model_id))?;
            }
            SidecarLaunchMode::IsolatedDirect => {}
        }
        let environment_file = settings.environment_file(model_id);
        match fs::remove_file(environment_file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        netns::teardown_veth(&netns::veth_host_name(namespace))?;
        netns::delete_netns(namespace)?;
        Ok(())
    }

    fn persist_to(settings: &RuntimeSettings, state: &RuntimeState) -> io::Result<()> {
        write_manifest(
            &settings.state_file,
            state.managed_models.iter().cloned().collect(),
        )
    }

    fn recover_managed_resources(&self) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("provisioner state unavailable"))?;
        if state.managed_models.is_empty() {
            Self::persist_to(&self.settings, &state)?;
            return Ok(());
        }
        let models: Vec<String> = state.managed_models.iter().cloned().collect();
        for model_id in models {
            let namespace = namespace_for(&model_id).map_err(io::Error::other)?;
            Self::cleanup_kernel_resources(&self.settings, &model_id, &namespace)?;
            state.managed_models.remove(&model_id);
        }
        Self::persist_to(&self.settings, &state)
    }
}

impl Drop for ProvisionerRuntime {
    fn drop(&mut self) {
        let settings = self.settings.clone();
        let Ok(state) = self.state.get_mut() else {
            return;
        };
        for (model_id, mut active) in state.active.drain() {
            if let Some(mut child) = active.child.take() {
                let _ = stop_child(&mut child);
            }
            if let Ok(namespace) = namespace_for(&model_id) {
                let _ = Self::cleanup_kernel_resources(&settings, &model_id, &namespace);
            }
            state.managed_models.remove(&model_id);
        }
        let remaining: Vec<_> = state.managed_models.iter().cloned().collect();
        for model_id in remaining {
            if let Ok(namespace) = namespace_for(&model_id) {
                if Self::cleanup_kernel_resources(&settings, &model_id, &namespace).is_ok() {
                    state.managed_models.remove(&model_id);
                }
            }
        }
        let _ = Self::persist_to(&settings, state);
    }
}

fn response(
    request: &Request,
    mode: EgressMode,
    namespace: String,
    status: &str,
    binding: Option<BindingInfo>,
) -> Response {
    Response {
        request_id: request.request_id.clone(),
        status: status.to_string(),
        namespace,
        mode: mode.as_str().to_string(),
        default_deny: true,
        binding,
    }
}

fn create_default_deny_namespace(namespace: &str) -> Result<(), BindFailure> {
    netns::create_netns(namespace).map_err(|error| BindFailure::BeforeNamespace(error.into()))?;
    let setup = (|| -> io::Result<()> {
        netns::execute_in_netns(namespace, &["ip", "link", "set", "lo", "up"])?;
        netns::set_null_default_route(namespace)?;
        netns::configure_default_deny_firewall(namespace)?;
        Ok(())
    })();
    if let Err(error) = setup {
        let _ = netns::delete_netns(namespace);
        return Err(BindFailure::AfterNamespace(error.into()));
    }
    inspect_default_deny_namespace(namespace).map_err(BindFailure::AfterNamespace)?;
    Ok(())
}

fn inspect_default_deny_namespace(namespace: &str) -> Result<(), ProvisionError> {
    let route = netns::execute_in_netns(namespace, &["ip", "route", "show", "default"])?;
    if !route.contains("blackhole default") {
        return Err(ProvisionError::Invalid(
            "namespace has no blackhole default route".to_string(),
        ));
    }
    for tool in ["iptables", "ip6tables"] {
        let output = netns::execute_in_netns(namespace, &[tool, "-S", "OUTPUT"])?;
        if !output.contains("-P OUTPUT DROP") {
            return Err(ProvisionError::Invalid(format!(
                "{tool} output policy is not DROP"
            )));
        }
    }
    Ok(())
}

fn read_manifest(path: &Path) -> io::Result<HashSet<String>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(HashSet::new()),
        Err(error) => return Err(error),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 64 * 1024 {
        return Err(io::Error::other("unsafe provisioner runtime state file"));
    }
    let bytes = fs::read(path)?;
    let manifest: RuntimeManifest = serde_json::from_slice(&bytes)
        .map_err(|_| io::Error::other("invalid provisioner runtime state file"))?;
    if manifest.version != STATE_VERSION {
        return Err(io::Error::other(
            "unsupported provisioner runtime state version",
        ));
    }
    let mut models = HashSet::new();
    for model_id in manifest.managed_models {
        namespace_for(&model_id).map_err(io::Error::other)?;
        if !models.insert(model_id) {
            return Err(io::Error::other(
                "duplicate model in provisioner runtime state",
            ));
        }
    }
    Ok(models)
}

fn write_manifest(path: &Path, mut managed_models: Vec<String>) -> io::Result<()> {
    managed_models.sort();
    let manifest = RuntimeManifest {
        version: STATE_VERSION,
        managed_models,
    };
    let mut encoded = Zeroizing::new(
        serde_json::to_vec(&manifest).map_err(|_| io::Error::other("invalid runtime state"))?,
    );
    let temp = path.with_extension(format!("tmp.{}.{}", std::process::id(), next_temp_id()));
    let mut file = private_new_file(&temp)?;
    let result: io::Result<()> = (|| {
        file.write_all(&encoded)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            fs::File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    encoded.zeroize();
    Ok(())
}

fn private_new_file(path: &Path) -> io::Result<fs::File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn next_temp_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn stop_child(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_none() {
        child.kill()?;
        let _ = child.wait()?;
    }
    Ok(())
}

fn wait_for_sidecar(address: SocketAddr) -> io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
            Ok(stream) => {
                drop(stream);
                return Ok(());
            }
            Err(_error) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err(io::Error::other("sidecar did not become ready")),
        }
    }
}

fn runner_unit(model_id: &str) -> String {
    format!("axiom-egress-runner@{model_id}.service")
}

fn sidecar_unit(model_id: &str) -> String {
    format!("axiom-egress-sidecar@{model_id}.service")
}

fn systemctl(args: &[&str]) -> io::Result<bool> {
    let output = Command::new("/usr/bin/systemctl").args(args).output()?;
    if output.status.success() {
        Ok(true)
    } else {
        Ok(false)
    }
}

fn systemd_unit_active(unit: &str) -> io::Result<bool> {
    let status = Command::new("/usr/bin/systemctl")
        .args(["is-active", "--quiet", unit])
        .status()?;
    match status.code() {
        Some(0) => Ok(true),
        Some(3 | 4) => Ok(false),
        _ => Err(io::Error::other("systemd unit state could not be verified")),
    }
}

fn stop_systemd_unit(unit: &str) -> io::Result<()> {
    if !systemd_unit_active(unit)? {
        return Ok(());
    }
    if systemctl(&["stop", "--no-block", unit])? {
        Ok(())
    } else {
        Err(io::Error::other("systemd unit did not stop"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Lease, PROTOCOL};

    #[test]
    fn manifest_rejects_duplicate_and_unsafe_model_ids() {
        let dir =
            std::env::temp_dir().join(format!("axiom-provisioner-state-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(
            &path,
            br#"{"version":1,"managed_models":["model_1","model_1"]}"#,
        )
        .unwrap();
        assert!(read_manifest(&path).is_err());
        fs::write(&path, br#"{"version":1,"managed_models":["../../host"]}"#).unwrap();
        assert!(read_manifest(&path).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn runtime_manifest_is_atomic_and_contains_only_model_identities() {
        let dir =
            std::env::temp_dir().join(format!("axiom-provisioner-manifest-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        write_manifest(&path, vec!["model_b".into(), "model_a".into()]).unwrap();
        let saved = fs::read_to_string(&path).unwrap();
        assert_eq!(
            saved,
            r#"{"version":1,"managed_models":["model_a","model_b"]}"#
        );
        assert!(!saved.contains("private_key"));
        assert_eq!(read_manifest(&path).unwrap().len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires the isolated Docker network-namespace rehearsal"]
    fn sidecar_watchdog_drops_egress_after_the_model_listener_exits() {
        const KEY: &[u8] = b"0123456789abcdef0123456789abcdef";
        let suffix = format!("{}_{}", std::process::id(), crate::now_unix().unwrap());
        let model_id = format!("watchdog_{suffix}");
        let namespace = namespace_for(&model_id).unwrap();
        let directory = std::env::temp_dir().join(format!("axiom-egress-watchdog-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let state_file = directory.join("state.json");
        let sidecar_bin = std::env::var_os("AXIOM_EGRESS_SIDECAR_BIN")
            .map(PathBuf::from)
            .expect("isolated rehearsal must build the egress-plane sidecar binary");
        let settings = RuntimeSettings::for_isolated_test(sidecar_bin, state_file.clone());
        let runtime = Arc::new(ProvisionerRuntime::new(settings).unwrap());
        let _watchdog = ProvisionerRuntime::start_sidecar_watchdog(&runtime).unwrap();
        let now = crate::now_unix().unwrap();
        let binding = BindingPolicy {
            subnet_octet: 249,
            proxy_addr: Some("192.0.2.10:3128".to_string()),
            proxy_connect_addr: Some("192.0.2.10:3128".to_string()),
            proxy_username: None,
            proxy_password: None,
            wg_public_key: None,
            wg_endpoint: None,
            wg_allowed_ips: None,
            wg_persistent_keepalive: None,
            wg_private_key: None,
            wg_preshared_key: None,
            iface_addr: None,
        };
        let mut bind_lease = Lease {
            org_id: "isolated_org".to_string(),
            model_id: model_id.clone(),
            mode: "http".to_string(),
            nonce: format!("watchdog_bind_{suffix}"),
            expires_unix: now + 60,
            signature: String::new(),
        };
        bind_lease.signature =
            crate::sign_lease_with_binding(KEY, Action::Bind, &bind_lease, Some(&binding)).unwrap();
        let bind = Request {
            protocol: PROTOCOL.to_string(),
            request_id: format!("watchdog_bind_request_{suffix}"),
            action: Action::Bind,
            lease: bind_lease,
            binding: Some(binding),
        };
        let mut release_lease = Lease {
            org_id: "isolated_org".to_string(),
            model_id: model_id.clone(),
            mode: "http".to_string(),
            nonce: format!("watchdog_release_{suffix}"),
            expires_unix: now + 60,
            signature: String::new(),
        };
        release_lease.signature = crate::sign_lease(KEY, Action::Release, &release_lease).unwrap();
        let release = Request {
            protocol: PROTOCOL.to_string(),
            request_id: format!("watchdog_release_request_{suffix}"),
            action: Action::Release,
            lease: release_lease,
            binding: None,
        };

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_eq!(runtime.apply(&bind, KEY, now).unwrap().status, "bound");
            {
                let mut state = runtime.state.lock().unwrap();
                let child = state
                    .active
                    .get_mut(&model_id)
                    .and_then(|active| active.child.as_mut())
                    .expect("isolated sidecar process must be tracked");
                child.kill().unwrap();
                child.wait().unwrap();
            }
            std::thread::sleep(Duration::from_millis(1_500));
            let output = netns::execute_in_netns(&namespace, &["iptables", "-S", "OUTPUT"])
                .expect("watchdog must inspect the owned test namespace");
            assert!(output.contains("-P OUTPUT DROP"));
            assert!(!output.contains("-d 192.0.2.10"));
        }));
        let cleanup = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_eq!(
                runtime
                    .apply(&release, KEY, crate::now_unix().unwrap())
                    .unwrap()
                    .status,
                "released"
            );
        }));
        let _ =
            ProvisionerRuntime::cleanup_kernel_resources(&runtime.settings, &model_id, &namespace);
        drop(runtime);
        let _ = fs::remove_dir_all(directory);
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
        if let Err(payload) = cleanup {
            std::panic::resume_unwind(payload);
        }
    }
}
