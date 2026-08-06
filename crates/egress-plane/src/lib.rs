use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tracing::{info, warn, instrument};
use uuid::Uuid;

pub mod config;
pub mod crypto;
pub mod db;
pub mod health;
pub mod killswitch;
pub mod metrics;
pub mod netns;
pub mod proxy;
pub mod tunnel;

use config::{EgressMode, NetworkConfig};
use health::HealthState;
use killswitch::KillSwitch;
use proxy::{ProxyKind, Upstream};

/// Port the sidecar proxy listens on INSIDE the model netns.
pub const SIDECAR_PORT: u16 = 8080;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum EgressError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("Reqwest error: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Crypto error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("Netns error: {0}")]
    Netns(String),

    #[error("Kill-switch error: {0}")]
    KillSwitch(String),

    #[error("Config error: {0}")]
    Config(String),
}

impl From<String> for EgressError {
    fn from(s: String) -> Self {
        EgressError::Config(s)
    }
}

impl IntoResponse for EgressError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            EgressError::Validation(_) | EgressError::Netns(_) | EgressError::Config(_) => {
                (StatusCode::BAD_REQUEST, self.to_string())
            }
            EgressError::KillSwitch(_) => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Config {
    pub kill_switch: String,
    pub listen_addr: String,
    /// Echo endpoint that reports the caller's egress IP.
    pub echo_url: String,
    pub database_url: Option<String>,
    pub dek: Option<[u8; 32]>,
    /// Path to the egress-plane binary used to spawn per-model sidecars
    /// (defaults to the running executable). Overridable for tests.
    pub sidecar_bin: Option<std::path::PathBuf>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            kill_switch: std::env::var("KILL_SWITCH").unwrap_or_else(|_| "false".to_string()),
            listen_addr: std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
            echo_url: std::env::var("EGRESS_ECHO_URL")
                .unwrap_or_else(|_| "https://api.ipify.org".to_string()),
            database_url: std::env::var("EGRESS_DATABASE_URL")
                .ok()
                .or_else(|| std::env::var("DATABASE_URL").ok()),
            dek: db::dek_from_env(),
            sidecar_bin: std::env::var("SIDECAR_BIN").ok().map(std::path::PathBuf::from),
        }
    }
}

// ---------------------------------------------------------------------------
// Application state + bound-egress registry
// ---------------------------------------------------------------------------

/// A bound model egress: namespace, veth bridge, sidecar child, health.
pub struct BoundEgress {
    pub config: NetworkConfig,
    pub ns: String,
    pub veth_host: String,
    pub host_ip: String, // host-side veth address clients connect to
    pub ns_ip: String,   // netns-side veth address sidecar binds to
    pub child: Option<std::process::Child>,
    pub upstream: Upstream,
    pub health: HealthState,
    pub failover_index: usize,
}

pub struct Registry {
    pub bounds: HashMap<String, BoundEgress>,
    pub used_octets: Vec<u16>,
    pub base_octet: u16,
    pub binds_total: u64,
    pub unbinds_total: u64,
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

impl Registry {
    pub fn new() -> Self {
        Self::with_start(1)
    }
    /// Registry whose veth subnets start at `base_octet` (10.240.<base>.0/30).
    /// Tests use distinct bases so parallel test servers never assign the
    /// same host-side veth IP.
    pub fn with_start(base_octet: u16) -> Self {
        Self {
            bounds: HashMap::new(),
            used_octets: Vec::new(),
            base_octet,
            binds_total: 0,
            unbinds_total: 0,
        }
    }

    fn alloc_octet(&mut self) -> Result<u16, String> {
        for octet in self.base_octet..=254u16 {
            if !self.used_octets.contains(&octet) && !host_subnet_in_use(octet) {
                self.used_octets.push(octet);
                return Ok(octet);
            }
        }
        Err("no free veth subnets available".to_string())
    }

    fn release_octet(&mut self, octet: u16) {
        self.used_octets.retain(|o| *o != octet);
    }
}

/// True when `10.240.<octet>.1/30` is already assigned to an interface in the
/// DEFAULT namespace. The egress plane, its integration tests, and any other
/// instance share the host's veth address space — a second bind on the same
/// subnet makes the host route to the netns-side `.2` ambiguous, so probes
/// can silently reach the WRONG sidecar (a healthy live chain instead of the
/// test's dead upstream). Skipping host-occupied subnets keeps every bind
/// isolated (L2.6 per-model netns).
fn host_subnet_in_use(octet: u16) -> bool {
    let needle = format!("10.240.{octet}.1/");
    let Ok(out) = std::process::Command::new("ip")
        .args(["-o", "addr", "show"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&out.stdout).contains(&needle)
}

pub struct AppState {
    pub config: Config,
    pub kill_switch: KillSwitch,
    pub db: Mutex<Option<tokio_postgres::Client>>,
    pub registry: Mutex<Registry>,
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BindRequest {
    pub model_id: String,
    #[serde(default)]
    pub org_id: String,
    pub mode: String,
    #[serde(default)]
    pub proxy_addr: Option<String>,
    #[serde(default)]
    pub wg_public_key: Option<String>,
    #[serde(default)]
    pub wg_endpoint: Option<String>,
    #[serde(default)]
    pub wg_allowed_ips: Option<String>,
    #[serde(default)]
    pub wg_persistent_keepalive: Option<i32>,
    #[serde(default)]
    pub expected_egress_ip: Option<String>,
    #[serde(default)]
    pub failover_proxy_addrs: Vec<String>,
    // Credentials — envelope-encrypted at rest by the control plane; the
    // egress plane receives them already decrypted over the trusted API.
    #[serde(default)]
    pub proxy_username: Option<String>,
    #[serde(default)]
    pub proxy_password: Option<String>,
    #[serde(default)]
    pub wg_private_key: Option<String>,
    #[serde(default)]
    pub wg_preshared_key: Option<String>,
    #[serde(default)]
    pub vpn_config: Option<String>,
    /// Tunnel interface address (CIDR) for wireguard/vpn modes.
    #[serde(default)]
    pub iface_addr: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnbindRequest {
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ModelRequest {
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
pub struct HealthCheckRequest {
    pub proxy_type: String,
    pub proxy_addr: String,
}

#[derive(Debug, Deserialize)]
pub struct DecryptRequest {
    pub enc_token: String,
    pub enc_nonce: String,
    pub dek_id: String,
    #[serde(default)]
    pub dek: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EncryptRequest {
    /// Base64-encoded plaintext (the serialized `Creds` JSON).
    pub plaintext: String,
    /// Vault DEK id this envelope is encrypted under.
    pub dek_id: String,
    /// Optional DEK override (base64, 32 bytes). When absent the
    /// configured `EGRESS_DEK` from the plane's environment is used.
    #[serde(default)]
    pub dek: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_switch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
pub struct DecryptResponse {
    pub plaintext: String,
    pub correlation_id: String,
}

#[derive(Debug, Serialize)]
pub struct EncryptResponse {
    /// Base64-encoded XChaCha20-Poly1305 ciphertext (tag included).
    pub enc_creds: String,
    /// Base64-encoded 24-byte nonce.
    pub enc_nonce: String,
    pub dek_id: String,
    pub correlation_id: String,
}

#[derive(Debug, Serialize)]
pub struct KillSwitchStatusResponse {
    pub enabled: bool,
    pub correlation_id: String,
}

// ---------------------------------------------------------------------------
// Binding engine
// ---------------------------------------------------------------------------

async fn resolve_config(req: &BindRequest) -> Result<NetworkConfig, EgressError> {
    let mode = EgressMode::from_str(&req.mode)
        .ok_or_else(|| EgressError::Validation(format!("invalid egress mode: {}", req.mode)))?;
    if req.model_id.is_empty() {
        return Err(EgressError::Validation("model_id must not be empty".to_string()));
    }
    if mode.is_proxy() && req.proxy_addr.is_none() {
        return Err(EgressError::Validation("proxy modes require proxy_addr".to_string()));
    }
    if mode.is_tunnel() && req.wg_private_key.is_none() {
        return Err(EgressError::Validation(
            "wireguard/vpn modes require wg_private_key (decrypted)".to_string(),
        ));
    }
    Ok(NetworkConfig {
        model_id: req.model_id.clone(),
        org_id: req.org_id.clone(),
        mode,
        proxy_addr: req.proxy_addr.clone(),
        wg_public_key: req.wg_public_key.clone(),
        wg_endpoint: req.wg_endpoint.clone(),
        wg_allowed_ips: req.wg_allowed_ips.clone(),
        wg_persistent_keepalive: req.wg_persistent_keepalive,
        expected_egress_ip: req.expected_egress_ip.clone(),
        failover_proxy_addrs: req.failover_proxy_addrs.clone(),
        enc_creds: None,
        enc_nonce: None,
        dek_id: None,
    })
}

fn proxy_upstream_for(cfg: &NetworkConfig, req: &BindRequest, addr: &str) -> Upstream {
    match cfg.mode {
        EgressMode::Socks5 => Upstream::Proxy {
            kind: ProxyKind::Socks5,
            addr: addr.to_string(),
            username: req.proxy_username.clone(),
            password: req.proxy_password.clone(),
        },
        EgressMode::Http | EgressMode::Https => Upstream::Proxy {
            kind: ProxyKind::Http,
            addr: addr.to_string(),
            username: req.proxy_username.clone(),
            password: req.proxy_password.clone(),
        },
        _ => Upstream::Direct,
    }
}

async fn bind_egress(state: &Arc<AppState>, req: &BindRequest) -> Result<BoundEgress, EgressError> {
    let cfg = resolve_config(req).await?;
    if state.kill_switch.is_enabled() {
        return Err(EgressError::KillSwitch("egress blocked by kill-switch".to_string()));
    }

    let exe = state
        .config
        .sidecar_bin
        .clone()
        .unwrap_or_else(|| std::env::current_exe().expect("current_exe"));
    let ns = cfg.netns_name();

    // ---- direct: no isolation (explicit opt-in) ----------------------------
    if cfg.mode == EgressMode::Direct {
        info!(model_id = %cfg.model_id, "Direct egress bound (no isolation — explicit opt-in)");
        return Ok(BoundEgress {
            config: cfg,
            ns: String::new(),
            veth_host: String::new(),
            host_ip: String::new(),
            ns_ip: String::new(),
            child: None,
            upstream: Upstream::Direct,
            health: HealthState::default(),
            failover_index: 0,
        });
    }

    // ---- isolated modes -----------------------------------------------------
    netns::create_netns(&ns)?;
    let octet = {
        let mut reg = state.registry.lock().unwrap();
        reg.alloc_octet()?
    };
    let host_ip = format!("10.240.{octet}.1/30");
    // The netns-side veth MUST carry the /30 prefix: with a bare /32 the
    // namespace has no connected route back to the host-side .1 address and
    // every reply (ARP, RST, ICMP) silently dies — "No route to host".
    let ns_ip_full = format!("10.240.{octet}.2/30");
    let ns_ip = format!("10.240.{octet}.2");
    let veth_host = netns::setup_veth(&ns, &host_ip, &ns_ip_full)?;

    let bind_result = async {
        if cfg.mode.is_tunnel() {
            // Tunnel modes: no blackhole — the tunnel route is the only route.
            let private_key = req
                .wg_private_key
                .as_deref()
                .ok_or_else(|| EgressError::Validation("missing wg_private_key".to_string()))?;
            let iface_addr = req.iface_addr.clone().unwrap_or_else(|| "10.7.0.2/32".to_string());
            let spec = tunnel::TunnelSpec::from_config(&cfg, private_key, &iface_addr)
                .map_err(EgressError::Validation)?;
            tunnel::bring_up_tunnel(&ns, &spec, private_key, req.wg_preshared_key.as_deref())?;
        } else {
            // Proxy modes: fail-closed blackhole + allow-list the approved
            // egress proxy hosts (primary + failover).
            netns::set_null_default_route(&ns)?;
            let mut hosts: Vec<String> = Vec::new();
            if let Some(addr) = &cfg.proxy_addr {
                hosts.push(addr.split(':').next().unwrap_or(addr).to_string());
            }
            for addr in &cfg.failover_proxy_addrs {
                let h = addr.split(':').next().unwrap_or(addr);
                if !hosts.iter().any(|x| x == h) {
                    hosts.push(h.to_string());
                }
            }
            for h in hosts {
                let sanitized = NetworkConfig::sanitize_hostport(&h).map_err(EgressError::Validation)?;
                netns::add_allow_rule(&ns, &sanitized)?;
            }
        }

        let upstream = match cfg.mode {
            EgressMode::Socks5 | EgressMode::Http | EgressMode::Https => {
                let primary = cfg
                    .proxy_addr
                    .clone()
                    .ok_or_else(|| EgressError::Validation("proxy modes require proxy_addr".to_string()))?;
                proxy_upstream_for(&cfg, req, &primary)
            }
            _ => Upstream::Direct,
        };

        let child = proxy::spawn_sidecar_in_netns(
            &ns,
            &exe,
            &ns_ip,
            SIDECAR_PORT,
            &upstream,
        )?;
        Ok::<_, EgressError>((upstream, child))
    }
    .await;

    let (upstream, child) = match bind_result {
        Ok(x) => x,
        Err(e) => {
            let _ = netns::delete_netns(&ns);
            let _ = netns::teardown_veth(&veth_host);
            {
                let mut reg = state.registry.lock().unwrap();
                reg.release_octet(octet);
            }
            return Err(e);
        }
    };

    // Give the sidecar a moment to bind its listener.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let bound = BoundEgress {
        config: cfg,
        ns,
        veth_host,
        // Clients connect to the NETNS-side veth address: it is on-link from
        // the host via the /30, and it is where the sidecar listener lives.
        // (The host-side .1 address is local to the host TCP stack, so the
        // host would refuse connections to it — no listener there.)
        host_ip: ns_ip.clone(),
        ns_ip,
        child: Some(child),
        upstream,
        health: HealthState::default(),
        failover_index: 0,
    };

    info!(model_id = %bound.config.model_id, mode = %bound.config.mode.as_str(), "Egress bound");
    Ok(bound)
}

/// Probe a bound egress through its sidecar (or directly for direct mode).
async fn probe_bound(state: &Arc<AppState>, bound: &mut BoundEgress) {
    let now = chrono_iso_now();
    let proxy: Option<(String, u16)> = if bound.config.mode == EgressMode::Direct {
        None
    } else {
        Some((bound.host_ip.clone(), SIDECAR_PORT))
    };
    let result = health::probe_echo(
        &state.config.echo_url,
        proxy.as_ref().map(|(h, p)| (h.as_str(), *p)),
        std::time::Duration::from_secs(10),
    )
    .await;
    let expected = bound.config.expected_egress_ip.clone();
    bound.health = health::reconcile_health(&bound.health, &result, expected.as_deref(), &now);
}

fn chrono_iso_now() -> String {
    // Minimal UTC ISO-8601 without pulling chrono into the graph: use the
    // system `date` command once per probe (sub-second precision is not
    // required for health timestamps).
    match std::process::Command::new("date").args(["-u", "+%Y-%m-%dT%H:%M:%SZ"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => "1970-01-01T00:00:00Z".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /health
#[instrument]
pub async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }),
    )
}

/// POST /egress/bind — bind a model's egress (netns + tunnel/proxy + sidecar)
#[instrument(skip(state))]
pub async fn egress_bind(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BindRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();
    let mut bound = bind_egress(&state, &body).await?;

    // First health probe (fail-closed: a dead egress is reported as unhealthy,
    // never silently switched to the host route).
    probe_bound(&state, &mut bound).await;

    let model_id = bound.config.model_id.clone();
    let mode = bound.config.mode.as_str().to_string();
    let health_snapshot = bound.health.clone();

    {
        let mut reg = state.registry.lock().unwrap();
        if let Some(prev) = reg.bounds.remove(&model_id) {
            let _ = teardown_bound(prev);
        }
        reg.binds_total += 1;
        reg.bounds.insert(model_id.clone(), bound);
    }

    // Persist health to Postgres when connected (take/replace: no lock held
    // across await, keeping the handler future Send).
    let mut client = state.db.lock().unwrap().take();
    if let Some(c) = client.as_mut() {
        let org = bound_config_org(&state, &model_id);
        let _ = db::save_health(
            c,
            &model_id,
            &org,
            health_snapshot.healthy,
            health_snapshot.latency_ms,
            health_snapshot.egress_ip.as_deref(),
            health_snapshot.fail_count,
            health_snapshot.drift,
            health_snapshot.last_error.as_deref(),
        )
        .await;
    }
    *state.db.lock().unwrap() = client;

    info!(correlation_id = %correlation_id, model_id = %model_id, "Egress bind complete");
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "bound",
            "model_id": model_id,
            "mode": mode,
            "kill_switch": state.kill_switch.is_enabled(),
            "healthy": health_snapshot.healthy,
            "egress_ip": health_snapshot.egress_ip,
            "latency_ms": health_snapshot.latency_ms,
            "drift": health_snapshot.drift,
            "last_error": health_snapshot.last_error,
            "correlation_id": correlation_id,
        })),
    ))
}

fn teardown_bound(mut bound: BoundEgress) -> io::Result<()> {
    if let Some(mut child) = bound.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if !bound.ns.is_empty() {
        if bound.config.mode.is_tunnel() {
            let _ = tunnel::teardown_tunnel(&bound.ns);
        }
        let _ = netns::delete_netns(&bound.ns);
    }
    if !bound.veth_host.is_empty() {
        let _ = netns::teardown_veth(&bound.veth_host);
    }
    Ok(())
}

fn bound_config_org(state: &Arc<AppState>, model_id: &str) -> String {
    state
        .registry
        .lock()
        .unwrap()
        .bounds
        .get(model_id)
        .map(|b| b.config.org_id.clone())
        .unwrap_or_default()
}

/// POST /egress/unbind — tear down a model's egress
#[instrument(skip(state))]
pub async fn egress_unbind(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UnbindRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();
    let removed = {
        let mut reg = state.registry.lock().unwrap();
        reg.unbinds_total += 1;
        reg.bounds.remove(&body.model_id)
    };
    match removed {
        Some(bound) => {
            let octet = bound.host_ip.split('.').nth(2).and_then(|s| s.parse::<u16>().ok());
            let _ = teardown_bound(bound);
            if let Some(o) = octet {
                state.registry.lock().unwrap().release_octet(o);
            }
            Ok((
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "unbound",
                    "model_id": body.model_id,
                    "correlation_id": correlation_id,
                })),
            ))
        }
        None => Err(EgressError::Validation(format!("model {} is not bound", body.model_id))),
    }
}

/// GET /egress/status — per-model egress + health
#[instrument(skip(state))]
pub async fn egress_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let reg = state.registry.lock().unwrap();
    let models: Vec<serde_json::Value> = reg
        .bounds
        .iter()
        .map(|(id, b)| {
            serde_json::json!({
                "model_id": id,
                "mode": b.config.mode.as_str(),
                "host_ip": b.host_ip,
                "upstream": match &b.upstream {
                    Upstream::Direct => "direct".to_string(),
                    Upstream::Proxy { addr, .. } => format!("proxy:{addr}"),
                },
                "healthy": b.health.healthy,
                "egress_ip": b.health.egress_ip,
                "latency_ms": b.health.latency_ms,
                "fail_count": b.health.fail_count,
                "drift": b.health.drift,
                "last_error": b.health.last_error,
                "failover_index": b.failover_index,
            })
        })
        .collect();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "count": models.len(),
            "models": models,
            "kill_switch": state.kill_switch.is_enabled(),
        })),
    )
}

/// POST /egress/health-check — force a re-probe (with failover)
#[instrument(skip(state))]
pub async fn egress_health_check_model(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ModelRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();
    let mut bound = state
        .registry
        .lock()
        .unwrap()
        .bounds
        .remove(&body.model_id)
        .ok_or_else(|| EgressError::Validation(format!("model {} is not bound", body.model_id)))?;

    probe_bound(&state, &mut bound).await;

    // Health-gated failover: proxy modes only, never to the host route.
    if !bound.health.healthy
        && bound.config.mode.is_proxy()
        && bound.failover_index < bound.config.failover_proxy_addrs.len()
    {
        let next = bound.config.failover_proxy_addrs[bound.failover_index].clone();
        bound.failover_index += 1;
        warn!(model_id = %body.model_id, failover = %next, "Failing over to approved alternate egress");
        let exe = state
            .config
            .sidecar_bin
            .clone()
            .unwrap_or_else(|| std::env::current_exe().unwrap());
        if let Some(mut child) = bound.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let upstream = proxy_upstream_for(&bound.config, &from_bound(&bound), &next);
        match proxy::spawn_sidecar_in_netns(&bound.ns, &exe, &bound.ns_ip, SIDECAR_PORT, &upstream) {
            Ok(child) => {
                bound.child = Some(child);
                bound.upstream = upstream;
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                probe_bound(&state, &mut bound).await;
            }
            Err(e) => {
                bound.health.last_error = Some(format!("failover spawn failed: {e}"));
            }
        }
    }

    let model_id = body.model_id.clone();
    let snapshot = bound.health.clone();
    let org = bound.config.org_id.clone();
    {
        state.registry.lock().unwrap().bounds.insert(model_id.clone(), bound);
    }
    let mut client = state.db.lock().unwrap().take();
    if let Some(c) = client.as_mut() {
        let _ = db::save_health(
            c,
            &model_id,
            &org,
            snapshot.healthy,
            snapshot.latency_ms,
            snapshot.egress_ip.as_deref(),
            snapshot.fail_count,
            snapshot.drift,
            snapshot.last_error.as_deref(),
        )
        .await;
    }
    *state.db.lock().unwrap() = client;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": if snapshot.healthy { "healthy" } else { "unhealthy" },
            "model_id": model_id,
            "egress_ip": snapshot.egress_ip,
            "latency_ms": snapshot.latency_ms,
            "drift": snapshot.drift,
            "fail_count": snapshot.fail_count,
            "last_error": snapshot.last_error,
            "correlation_id": correlation_id,
        })),
    ))
}

fn from_bound(bound: &BoundEgress) -> BindRequest {
    let cfg = &bound.config;
    BindRequest {
        model_id: cfg.model_id.clone(),
        org_id: cfg.org_id.clone(),
        mode: cfg.mode.as_str().to_string(),
        proxy_addr: cfg.proxy_addr.clone(),
        wg_public_key: cfg.wg_public_key.clone(),
        wg_endpoint: cfg.wg_endpoint.clone(),
        wg_allowed_ips: cfg.wg_allowed_ips.clone(),
        wg_persistent_keepalive: cfg.wg_persistent_keepalive,
        expected_egress_ip: cfg.expected_egress_ip.clone(),
        failover_proxy_addrs: cfg.failover_proxy_addrs.clone(),
        proxy_username: None,
        proxy_password: None,
        wg_private_key: None,
        wg_preshared_key: None,
        vpn_config: None,
        iface_addr: None,
    }
}

/// POST /egress/health-check — legacy utility probe (kept for compatibility)
#[instrument(skip(_state))]
pub async fn egress_health_check(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<HealthCheckRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();
    let healthy = netns::health_check_proxy(&body.proxy_type, &body.proxy_addr)
        .await
        .map_err(EgressError::Netns)?;
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": if healthy { "healthy" } else { "unhealthy" },
            "proxy_type": body.proxy_type,
            "proxy_addr": body.proxy_addr,
            "correlation_id": correlation_id,
        })),
    ))
}

/// POST /egress/decrypt — envelope decryption (kept for compatibility)
#[instrument(skip(_state))]
pub async fn egress_decrypt(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<DecryptRequest>,
) -> Result<impl IntoResponse, EgressError> {
    use base64::Engine as _;
    let correlation_id = Uuid::new_v4().to_string();
    let enc_token = base64::engine::general_purpose::STANDARD
        .decode(&body.enc_token)
        .map_err(|e| EgressError::Validation(format!("invalid enc_token: {e}")))?;
    let enc_nonce = base64::engine::general_purpose::STANDARD
        .decode(&body.enc_nonce)
        .map_err(|e| EgressError::Validation(format!("invalid enc_nonce: {e}")))?;
    let mut dek = match &body.dek {
        Some(d) => base64::engine::general_purpose::STANDARD
            .decode(d)
            .map_err(|e| EgressError::Validation(format!("invalid dek: {e}")))?,
        None => {
            return Err(EgressError::Validation(
                "DEK not provided and vault integration not yet connected".to_string(),
            ));
        }
    };
    let plaintext = crypto::decrypt_envelope(&enc_token, &enc_nonce, &dek)?;
    crypto::zeroize(dek.as_mut_slice());
    Ok((
        StatusCode::OK,
        Json(DecryptResponse {
            plaintext: base64::engine::general_purpose::STANDARD.encode(&plaintext),
            correlation_id,
        }),
    ))
}

/// POST /egress/encrypt — envelope-encrypt credential plaintext for
/// storage in `model_network_configs.enc_creds` (L2.6). The API control
/// plane calls this BEFORE writing a config row, so secrets never touch
/// the API process in plaintext after this call; the DEK stays in the
/// egress plane's environment.
#[instrument(skip(state))]
pub async fn egress_encrypt(
    State(state): State<Arc<AppState>>,
    Json(body): Json<EncryptRequest>,
) -> Result<impl IntoResponse, EgressError> {
    use base64::Engine as _;
    let correlation_id = Uuid::new_v4().to_string();

    let plaintext = base64::engine::general_purpose::STANDARD
        .decode(&body.plaintext)
        .map_err(|e| EgressError::Validation(format!("invalid plaintext: {e}")))?;

    // Resolve the DEK: explicit override wins, else the configured env DEK.
    let mut dek: Vec<u8> = match &body.dek {
        Some(d) => base64::engine::general_purpose::STANDARD
            .decode(d)
            .map_err(|e| EgressError::Validation(format!("invalid dek: {e}")))?,
        None => state
            .config
            .dek
            .map(|d| d.to_vec())
            .ok_or_else(|| EgressError::Validation("EGRESS_DEK not configured".to_string()))?,
    };
    if dek.len() != 32 {
        return Err(EgressError::Validation("DEK must be 32 bytes".to_string()));
    }

    let (ct, nonce) = crypto::encrypt_envelope(&plaintext, &dek)?;
    crypto::zeroize(dek.as_mut_slice());

    Ok((
        StatusCode::OK,
        Json(EncryptResponse {
            enc_creds: base64::engine::general_purpose::STANDARD.encode(&ct),
            enc_nonce: base64::engine::general_purpose::STANDARD.encode(&nonce),
            dek_id: body.dek_id,
            correlation_id,
        }),
    ))
}

/// POST /kill-switch/drain — kill all bound egress immediately
#[instrument(skip(state))]
pub async fn kill_switch_drain(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();
    warn!(correlation_id = %correlation_id, "Kill-switch drain requested");
    state.kill_switch.set_enabled(true);
    let bound_list: Vec<String> = state.registry.lock().unwrap().bounds.keys().cloned().collect();
    for model_id in bound_list {
        if let Some(bound) = state.registry.lock().unwrap().bounds.remove(&model_id) {
            let _ = teardown_bound(bound);
        }
    }
    state.registry.lock().unwrap().unbinds_total += 1;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "draining",
            "kill_switch": true,
            "correlation_id": correlation_id,
        })),
    )
}

/// GET /kill-switch/status
#[instrument(skip(state))]
pub async fn kill_switch_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();
    (
        StatusCode::OK,
        Json(KillSwitchStatusResponse {
            enabled: state.kill_switch.is_enabled(),
            correlation_id,
        }),
    )
}

/// POST /kill-switch/disable
#[instrument(skip(state))]
pub async fn kill_switch_disable(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();
    state.kill_switch.set_enabled(false);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "disabled",
            "kill_switch": false,
            "correlation_id": correlation_id,
        })),
    )
}

/// GET /metrics — Prometheus text format
#[instrument(skip(state))]
pub async fn metrics(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let reg = state.registry.lock().unwrap();
    let m = metrics::Metrics {
        models_bound: reg.bounds.len(),
        kill_switch: state.kill_switch.is_enabled(),
        binds_total: reg.binds_total,
        unbinds_total: reg.unbinds_total,
        health: reg
            .bounds
            .iter()
            .map(|(id, b)| (id.clone(), (b.config.mode.as_str().to_string(), b.health.clone())))
            .collect(),
    };
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        m.render(),
    )
}

/// POST /egress/sync — load all configs from Postgres and bind them
#[instrument(skip(state))]
pub async fn egress_sync(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();
    let mut client = state.db.lock().unwrap().take();
    let configs = match client.as_mut() {
        Some(c) => db::load_configs(c).await.map_err(EgressError::Config)?,
        None => return Err(EgressError::Config("DATABASE_URL not configured".to_string())),
    };
    *state.db.lock().unwrap() = client;
    let mut bound = 0usize;
    let mut skipped = 0usize;
    for cfg in configs {
        if state.kill_switch.is_enabled() {
            skipped += 1;
            continue;
        }
        // Skip direct-mode rows (no isolation to enforce).
        if cfg.mode == EgressMode::Direct {
            skipped += 1;
            continue;
        }
        let creds = db::decrypt_creds(&cfg, state.config.dek.as_ref().map(|d| d.as_slice()))
            .map_err(EgressError::Config)?;
        let req = BindRequest {
            model_id: cfg.model_id.clone(),
            org_id: cfg.org_id.clone(),
            mode: cfg.mode.as_str().to_string(),
            proxy_addr: cfg.proxy_addr.clone(),
            wg_public_key: cfg.wg_public_key.clone(),
            wg_endpoint: cfg.wg_endpoint.clone(),
            wg_allowed_ips: cfg.wg_allowed_ips.clone(),
            wg_persistent_keepalive: cfg.wg_persistent_keepalive,
            expected_egress_ip: cfg.expected_egress_ip.clone(),
            failover_proxy_addrs: cfg.failover_proxy_addrs.clone(),
            proxy_username: creds.as_ref().and_then(|c| c.proxy_username.clone()),
            proxy_password: creds.as_ref().and_then(|c| c.proxy_password.clone()),
            wg_private_key: creds.as_ref().and_then(|c| c.wg_private_key.clone()),
            wg_preshared_key: creds.as_ref().and_then(|c| c.wg_preshared_key.clone()),
            vpn_config: creds.as_ref().and_then(|c| c.vpn_config.clone()),
            iface_addr: None,
        };
        match bind_egress(&state, &req).await {
            Ok(mut b) => {
                probe_bound(&state, &mut b).await;
                state.registry.lock().unwrap().binds_total += 1;
                state.registry.lock().unwrap().bounds.insert(cfg.model_id.clone(), b);
                bound += 1;
            }
            Err(e) => {
                warn!(model_id = %cfg.model_id, error = %e, "sync bind failed");
                skipped += 1;
            }
        }
    }
    info!(correlation_id = %correlation_id, bound = bound, skipped = skipped, "Egress sync complete");
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "synced",
            "bound": bound,
            "skipped": skipped,
            "correlation_id": correlation_id,
        })),
    ))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/egress/bind", post(egress_bind))
        .route("/egress/unbind", post(egress_unbind))
        .route("/egress/status", get(egress_status))
        .route("/egress/health-check", post(egress_health_check))
        .route("/egress/health-check/model", post(egress_health_check_model))
        .route("/egress/decrypt", post(egress_decrypt))
        .route("/egress/encrypt", post(egress_encrypt))
        .route("/egress/sync", post(egress_sync))
        .route("/kill-switch/drain", post(kill_switch_drain))
        .route("/kill-switch/status", get(kill_switch_status))
        .route("/kill-switch/disable", post(kill_switch_disable))
        .with_state(state)
}

/// Build a test router (used by integration tests).
pub fn build_router_for_test(state: Arc<AppState>) -> Router {
    build_router(state)
}
