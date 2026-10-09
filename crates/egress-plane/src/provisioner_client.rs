use crate::netns;
use crate::provisioner_protocol::{
    namespace_for, now_unix, sign_lease_with_binding, Action, BindingPolicy, Lease, Request,
    Response, PROTOCOL,
};
use crate::{BindRequest, NetworkConfig};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
const MAX_REPLY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct ProvisionerClient {
    socket: PathBuf,
    lease_key: Arc<Zeroizing<Vec<u8>>>,
}

impl std::fmt::Debug for ProvisionerClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProvisionerClient")
            .field("socket", &self.socket)
            .field("lease_key", &"[REDACTED]")
            .finish()
    }
}

impl ProvisionerClient {
    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self {
            socket: PathBuf::from("/tmp/axiom-egress-provisioner-test.sock"),
            lease_key: Arc::new(Zeroizing::new(b"0123456789abcdef0123456789abcdef".to_vec())),
        }
    }

    pub fn from_env() -> Result<Option<Self>, String> {
        let socket = std::env::var_os("EGRESS_PROVISIONER_SOCKET").map(PathBuf::from);
        let key = std::env::var("AXIOM_EGRESS_LEASE_KEY").ok();
        match (socket, key) {
            (None, None) => Ok(None),
            (Some(socket), Some(mut key)) => {
                if !socket.is_absolute() {
                    key.zeroize();
                    return Err("EGRESS_PROVISIONER_SOCKET must be an absolute path".to_string());
                }
                let key = Zeroizing::new(key.into_bytes());
                if key.len() < 32 {
                    return Err("AXIOM_EGRESS_LEASE_KEY must be at least 32 bytes".to_string());
                }
                Ok(Some(Self {
                    socket,
                    lease_key: Arc::new(key),
                }))
            }
            (Some(_), None) | (None, Some(_)) => Err(
                "EGRESS_PROVISIONER_SOCKET and AXIOM_EGRESS_LEASE_KEY must be configured together"
                    .to_string(),
            ),
        }
    }

    pub fn bind(&self, request: &BindRequest, subnet_octet: u16) -> Result<Response, String> {
        let mode = crate::config::EgressMode::from_str(&request.mode)
            .ok_or_else(|| "invalid egress mode".to_string())?;
        let proxy_connect_addr = if mode.is_proxy() {
            let address = request
                .proxy_addr
                .as_deref()
                .ok_or_else(|| "proxy address is required".to_string())?;
            Some(
                netns::resolve_endpoint(address)
                    .map_err(|_| "proxy endpoint resolution failed".to_string())?
                    .to_string(),
            )
        } else {
            None
        };
        let wg_endpoint = if mode.is_tunnel() {
            let address = request
                .wg_endpoint
                .as_deref()
                .ok_or_else(|| "tunnel endpoint is required".to_string())?;
            Some(
                netns::resolve_endpoint(address)
                    .map_err(|_| "tunnel endpoint resolution failed".to_string())?
                    .to_string(),
            )
        } else {
            None
        };
        let binding = BindingPolicy {
            subnet_octet,
            proxy_addr: request.proxy_addr.clone(),
            proxy_connect_addr,
            proxy_username: request.proxy_username.clone(),
            proxy_password: request.proxy_password.clone(),
            wg_public_key: request.wg_public_key.clone(),
            wg_endpoint,
            wg_allowed_ips: request.wg_allowed_ips.clone(),
            wg_persistent_keepalive: request.wg_persistent_keepalive,
            wg_private_key: request.wg_private_key.clone(),
            wg_preshared_key: request.wg_preshared_key.clone(),
            iface_addr: request.iface_addr.clone(),
        };
        let expected_endpoint = binding.proxy_connect_addr.clone();
        let response = self.call(
            Action::Bind,
            &request.org_id,
            &request.model_id,
            &request.mode,
            Some(binding),
        )?;
        let info = response
            .binding
            .as_ref()
            .ok_or_else(|| "local egress provisioner omitted binding metadata".to_string())?;
        let expected_ip = format!("10.240.{subnet_octet}.2");
        let expected_veth = crate::netns::veth_host_name(&response.namespace);
        if info.host_ip != expected_ip
            || info.ns_ip != expected_ip
            || info.veth_host != expected_veth
        {
            return Err("local egress provisioner returned invalid binding metadata".to_string());
        }
        match (expected_endpoint, info.upstream_connect_addr.as_deref()) {
            (Some(expected), Some(actual)) if expected == actual => {
                let endpoint = actual.parse::<std::net::SocketAddr>().map_err(|_| {
                    "local egress provisioner returned an invalid proxy endpoint".to_string()
                })?;
                if !endpoint.is_ipv4() {
                    return Err(
                        "local egress provisioner returned an invalid proxy endpoint".to_string(),
                    );
                }
            }
            (None, None) => {}
            _ => {
                return Err(
                    "local egress provisioner returned an unexpected upstream endpoint".into(),
                )
            }
        }
        Ok(response)
    }

    pub fn release(&self, config: &NetworkConfig) -> Result<Response, String> {
        self.call(
            Action::Release,
            &config.org_id,
            &config.model_id,
            config.mode.as_str(),
            None,
        )
    }

    pub fn inspect(&self, config: &NetworkConfig) -> Result<Response, String> {
        self.call(
            Action::Inspect,
            &config.org_id,
            &config.model_id,
            config.mode.as_str(),
            None,
        )
    }

    fn call(
        &self,
        action: Action,
        org_id: &str,
        model_id: &str,
        mode: &str,
        binding: Option<BindingPolicy>,
    ) -> Result<Response, String> {
        let now = now_unix().map_err(|_| "provisioner clock unavailable".to_string())?;
        let request_id = Uuid::new_v4().to_string();
        let expected_namespace =
            namespace_for(model_id).map_err(|_| "invalid model namespace".to_string())?;
        let expected_status = match action {
            Action::Create => "created",
            Action::Bind => "bound",
            Action::Inspect => "ready",
            Action::Release => "released",
        };
        let mut lease = Lease {
            org_id: org_id.to_string(),
            model_id: model_id.to_string(),
            mode: mode.to_string(),
            nonce: Uuid::new_v4().to_string(),
            expires_unix: now.saturating_add(60),
            signature: String::new(),
        };
        lease.signature =
            sign_lease_with_binding(&self.lease_key, action, &lease, binding.as_ref())
                .map_err(|_| "provisioner request could not be signed".to_string())?;
        let request = Request {
            protocol: PROTOCOL.to_string(),
            request_id: request_id.clone(),
            action,
            lease,
            binding,
        };
        let mut payload = Zeroizing::new(
            serde_json::to_vec(&request)
                .map_err(|_| "provisioner request could not be encoded".to_string())?,
        );
        let result = transact(&self.socket, &payload).and_then(|response| {
            if response.request_id != request_id
                || response.namespace != expected_namespace
                || response.mode != mode.to_ascii_lowercase()
                || response.status != expected_status
                || !response.default_deny
            {
                return Err("local egress provisioner response did not match the request".into());
            }
            Ok(response)
        });
        payload.zeroize();
        result
    }
}

#[cfg(unix)]
fn transact(socket: &std::path::Path, payload: &[u8]) -> Result<Response, String> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::net::UnixStream;

    let mut stream = UnixStream::connect(socket)
        .map_err(|_| "local egress provisioner is unavailable".to_string())?;
    let timeout = Some(Duration::from_secs(30));
    stream
        .set_read_timeout(timeout)
        .and_then(|_| stream.set_write_timeout(timeout))
        .map_err(|_| "local egress provisioner timeout could not be configured".to_string())?;
    stream
        .write_all(payload)
        .and_then(|_| stream.write_all(b"\n"))
        .map_err(|_| "local egress provisioner request failed".to_string())?;
    stream
        .flush()
        .map_err(|_| "local egress provisioner request failed".to_string())?;
    let mut line = Vec::with_capacity(256);
    let reader = BufReader::new(stream);
    let mut limited = reader.take((MAX_REPLY_BYTES + 1) as u64);
    limited
        .read_until(b'\n', &mut line)
        .map_err(|_| "local egress provisioner response failed".to_string())?;
    if line.len() > MAX_REPLY_BYTES || line.last() != Some(&b'\n') {
        return Err("local egress provisioner response was invalid".to_string());
    }
    let response: Result<Response, String> = serde_json::from_slice(&line)
        .map_err(|_| "local egress provisioner response was invalid".to_string())?;
    response.map_err(|_| "local egress provisioner rejected the request".to_string())
}

#[cfg(not(unix))]
fn transact(_socket: &std::path::Path, _payload: &[u8]) -> Result<Response, String> {
    Err("local egress provisioner requires Unix sockets".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_debug_redacts_the_lease_key() {
        let client = ProvisionerClient {
            socket: PathBuf::from("/run/axiom/egress/provisioner.sock"),
            lease_key: Arc::new(Zeroizing::new(
                b"synthetic-secret-key-value-123456".to_vec(),
            )),
        };
        let printed = format!("{client:?}");
        assert!(printed.contains("REDACTED"));
        assert!(!printed.contains("synthetic-secret"));
    }
}
