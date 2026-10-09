//! Authenticated wire contract shared by the unprivileged egress plane and
//! the narrowly privileged local provisioner.
//!
//! The provisioner accepts typed operations only. Callers cannot supply shell
//! commands, executable paths, interface names, routes, or raw namespace names.

use base64::Engine as _;
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const PROTOCOL: &str = "AXIOM_EGRESS_PROVISIONER_V1";
pub const MAX_LEASE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Create,
    Bind,
    Inspect,
    Release,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Bind => "bind",
            Self::Inspect => "inspect",
            Self::Release => "release",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lease {
    pub org_id: String,
    pub model_id: String,
    pub mode: String,
    pub nonce: String,
    pub expires_unix: u64,
    pub signature: String,
}

/// Persisted, typed network policy plus decrypted credentials scoped to one
/// bind request. Secret strings are zeroized when the request is dropped.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct BindingPolicy {
    pub subnet_octet: u16,
    pub proxy_addr: Option<String>,
    pub proxy_connect_addr: Option<String>,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    pub wg_public_key: Option<String>,
    pub wg_endpoint: Option<String>,
    pub wg_allowed_ips: Option<String>,
    pub wg_persistent_keepalive: Option<i32>,
    pub wg_private_key: Option<String>,
    pub wg_preshared_key: Option<String>,
    pub iface_addr: Option<String>,
}

impl BindingPolicy {
    pub fn validate(&self, mode: crate::config::EgressMode) -> Result<(), ProvisionError> {
        if !(1..=254).contains(&self.subnet_octet) {
            return Err(ProvisionError::Invalid(
                "invalid subnet allocation".to_string(),
            ));
        }
        if mode.is_proxy() {
            let proxy = self
                .proxy_addr
                .as_deref()
                .ok_or_else(|| ProvisionError::Invalid("proxy address is required".to_string()))?;
            crate::config::NetworkConfig::sanitize_hostport(proxy)
                .map_err(|_| ProvisionError::Invalid("invalid proxy address".to_string()))?;
            let connect = self
                .proxy_connect_addr
                .as_deref()
                .ok_or_else(|| {
                    ProvisionError::Invalid("resolved proxy address is required".to_string())
                })?
                .parse::<std::net::SocketAddr>()
                .map_err(|_| {
                    ProvisionError::Invalid("invalid resolved proxy address".to_string())
                })?;
            if !connect.is_ipv4() {
                return Err(ProvisionError::Invalid(
                    "resolved proxy address must be IPv4".to_string(),
                ));
            }
            let proxy_url = url::Url::parse(&format!("http://{proxy}"))
                .map_err(|_| ProvisionError::Invalid("invalid proxy address".to_string()))?;
            if proxy_url.port() != Some(connect.port()) {
                return Err(ProvisionError::Invalid(
                    "resolved proxy port does not match configured proxy port".to_string(),
                ));
            }
            if self.wg_private_key.is_some()
                || self.wg_preshared_key.is_some()
                || self.wg_public_key.is_some()
                || self.wg_endpoint.is_some()
                || self.wg_allowed_ips.is_some()
                || self.iface_addr.is_some()
            {
                return Err(ProvisionError::Invalid(
                    "proxy binding contains tunnel configuration".to_string(),
                ));
            }
            if self
                .proxy_username
                .as_ref()
                .is_some_and(|value| value.len() > 1024)
                || self
                    .proxy_password
                    .as_ref()
                    .is_some_and(|value| value.len() > 1024)
            {
                return Err(ProvisionError::Invalid(
                    "proxy credential exceeds its length limit".to_string(),
                ));
            }
            return Ok(());
        }
        if mode.is_tunnel() {
            if self.proxy_addr.is_some()
                || self.proxy_connect_addr.is_some()
                || self.proxy_username.is_some()
                || self.proxy_password.is_some()
            {
                return Err(ProvisionError::Invalid(
                    "tunnel binding contains proxy configuration".to_string(),
                ));
            }
            let private_key = self.wg_private_key.as_deref().ok_or_else(|| {
                ProvisionError::Invalid("tunnel private key is required".to_string())
            })?;
            let public_key = self.wg_public_key.as_deref().ok_or_else(|| {
                ProvisionError::Invalid("tunnel public key is required".to_string())
            })?;
            let endpoint = self.wg_endpoint.as_deref().ok_or_else(|| {
                ProvisionError::Invalid("tunnel endpoint is required".to_string())
            })?;
            let allowed_ips = self.wg_allowed_ips.as_deref().ok_or_else(|| {
                ProvisionError::Invalid("tunnel allowed IPs are required".to_string())
            })?;
            for key in [private_key, public_key] {
                crate::config::NetworkConfig::sanitize_key(key)
                    .map_err(|_| ProvisionError::Invalid("invalid tunnel key".to_string()))?;
            }
            if let Some(key) = self.wg_preshared_key.as_deref() {
                crate::config::NetworkConfig::sanitize_key(key)
                    .map_err(|_| ProvisionError::Invalid("invalid tunnel key".to_string()))?;
            }
            crate::config::NetworkConfig::sanitize_hostport(endpoint)
                .map_err(|_| ProvisionError::Invalid("invalid tunnel endpoint".to_string()))?;
            let resolved_endpoint = endpoint.parse::<std::net::SocketAddr>().map_err(|_| {
                ProvisionError::Invalid(
                    "tunnel endpoint must be a resolved IPv4 address".to_string(),
                )
            })?;
            if !resolved_endpoint.is_ipv4() {
                return Err(ProvisionError::Invalid(
                    "tunnel endpoint must be a resolved IPv4 address".to_string(),
                ));
            }
            crate::config::NetworkConfig::sanitize_cidrs(allowed_ips)
                .map_err(|_| ProvisionError::Invalid("invalid tunnel allowed IPs".to_string()))?;
            if let Some(address) = self.iface_addr.as_deref() {
                crate::config::NetworkConfig::sanitize_cidrs(address).map_err(|_| {
                    ProvisionError::Invalid("invalid tunnel interface address".to_string())
                })?;
            }
            if self
                .wg_persistent_keepalive
                .is_some_and(|value| !(0..=65535).contains(&value))
            {
                return Err(ProvisionError::Invalid(
                    "invalid tunnel keepalive".to_string(),
                ));
            }
            return Ok(());
        }
        Err(ProvisionError::Invalid(
            "direct mode cannot be provisioned".to_string(),
        ))
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: String,
    pub request_id: String,
    pub action: Action,
    pub lease: Lease,
    #[serde(default)]
    pub binding: Option<BindingPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BindingInfo {
    pub host_ip: String,
    pub ns_ip: String,
    pub veth_host: String,
    pub tunnel_handshake: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_connect_addr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Response {
    pub request_id: String,
    pub status: String,
    pub namespace: String,
    pub mode: String,
    pub default_deny: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<BindingInfo>,
}

/// Process-local single-use lease tracking. A caller must validate the signed
/// request before reserving its nonce, so unauthenticated input cannot consume
/// valid lease capacity.
#[derive(Default)]
pub struct ReplayRegistry {
    used: Mutex<HashSet<String>>,
}

impl ReplayRegistry {
    pub fn reserve(&self, nonce: &str) -> Result<(), ProvisionError> {
        let mut used = self
            .used
            .lock()
            .map_err(|_| ProvisionError::Invalid("replay registry unavailable".to_string()))?;
        if !used.insert(nonce.to_string()) {
            return Err(ProvisionError::Invalid("replayed lease nonce".to_string()));
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum ProvisionError {
    #[error("invalid provisioner request: {0}")]
    Invalid(String),
    #[error("lease authentication failed")]
    Unauthorized,
    #[error("namespace operation failed: {0}")]
    Netns(#[from] std::io::Error),
}

pub fn now_unix() -> Result<u64, ProvisionError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| ProvisionError::Invalid("system clock before epoch".to_string()))
}

pub fn lease_payload(action: Action, lease: &Lease) -> String {
    format!(
        "{PROTOCOL}\0{}\0{}\0{}\0{}\0{}\0{}",
        action.as_str(),
        lease.org_id,
        lease.model_id,
        lease.mode,
        lease.nonce,
        lease.expires_unix,
    )
}

fn signed_payload(
    action: Action,
    lease: &Lease,
    binding: Option<&BindingPolicy>,
) -> Result<Vec<u8>, ProvisionError> {
    let mut payload = lease_payload(action, lease).into_bytes();
    if let Some(binding) = binding {
        payload.push(0);
        let mut encoded = serde_json::to_vec(binding)
            .map_err(|_| ProvisionError::Invalid("invalid bind policy".to_string()))?;
        payload.extend_from_slice(&encoded);
        encoded.zeroize();
    }
    Ok(payload)
}

pub fn sign_lease(key: &[u8], action: Action, lease: &Lease) -> Result<String, ProvisionError> {
    sign_lease_with_binding(key, action, lease, None)
}

pub fn sign_lease_with_binding(
    key: &[u8],
    action: Action,
    lease: &Lease,
    binding: Option<&BindingPolicy>,
) -> Result<String, ProvisionError> {
    validate_key(key)?;
    let mut payload = signed_payload(action, lease, binding)?;
    let signature = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), &payload);
    payload.zeroize();
    Ok(base64::engine::general_purpose::STANDARD.encode(signature.as_ref()))
}

pub fn validate_request(
    request: &Request,
    key: &[u8],
    now: u64,
) -> Result<crate::config::EgressMode, ProvisionError> {
    validate_key(key)?;
    if request.protocol != PROTOCOL {
        return Err(ProvisionError::Invalid("unsupported protocol".to_string()));
    }
    validate_identifier("request_id", &request.request_id, 16, 96)?;
    validate_identifier("org_id", &request.lease.org_id, 1, 64)?;
    validate_identifier("model_id", &request.lease.model_id, 1, 64)?;
    validate_identifier("nonce", &request.lease.nonce, 16, 128)?;
    if request.lease.expires_unix < now || request.lease.expires_unix > now + MAX_LEASE_TTL_SECS {
        return Err(ProvisionError::Invalid(
            "lease expiry is outside the accepted window".to_string(),
        ));
    }
    let mode = crate::config::EgressMode::from_str(&request.lease.mode)
        .ok_or_else(|| ProvisionError::Invalid("unsupported egress mode".to_string()))?;
    if mode == crate::config::EgressMode::Direct {
        return Err(ProvisionError::Invalid(
            "direct mode has no provisioned namespace".to_string(),
        ));
    }
    match (request.action, request.binding.as_ref()) {
        (Action::Bind, Some(binding)) => binding.validate(mode)?,
        (Action::Bind, None) => {
            return Err(ProvisionError::Invalid(
                "bind policy is required".to_string(),
            ))
        }
        (_, Some(_)) => {
            return Err(ProvisionError::Invalid(
                "bind policy is only valid for bind operations".to_string(),
            ))
        }
        (_, None) => {}
    }
    let supplied = base64::engine::general_purpose::STANDARD
        .decode(&request.lease.signature)
        .map_err(|_| ProvisionError::Unauthorized)?;
    let mut payload = signed_payload(request.action, &request.lease, request.binding.as_ref())?;
    let verification = hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, key), &payload, &supplied);
    payload.zeroize();
    verification.map_err(|_| ProvisionError::Unauthorized)?;
    Ok(mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn proxy_binding() -> BindingPolicy {
        BindingPolicy {
            subnet_octet: 12,
            proxy_addr: Some("proxy.example.test:3128".to_string()),
            proxy_connect_addr: Some("192.0.2.10:3128".to_string()),
            proxy_username: Some("fixture-user".to_string()),
            proxy_password: Some("fixture-password".to_string()),
            wg_public_key: None,
            wg_endpoint: None,
            wg_allowed_ips: None,
            wg_persistent_keepalive: None,
            wg_private_key: None,
            wg_preshared_key: None,
            iface_addr: None,
        }
    }

    fn bind_request(binding: BindingPolicy) -> Request {
        let mut lease = Lease {
            org_id: "org_1".to_string(),
            model_id: "model_1".to_string(),
            mode: "http".to_string(),
            nonce: "nonce_for_test_0001".to_string(),
            expires_unix: 1_700_000_100,
            signature: String::new(),
        };
        lease.signature =
            sign_lease_with_binding(KEY, Action::Bind, &lease, Some(&binding)).unwrap();
        Request {
            protocol: PROTOCOL.to_string(),
            request_id: "request_for_test_0001".to_string(),
            action: Action::Bind,
            lease,
            binding: Some(binding),
        }
    }

    #[test]
    fn bind_signature_covers_the_entire_network_policy() {
        let request = bind_request(proxy_binding());
        assert!(validate_request(&request, KEY, 1_700_000_000).is_ok());

        let mut tampered = request;
        tampered.binding.as_mut().unwrap().proxy_addr = Some("other.example.test:3128".to_string());
        assert!(matches!(
            validate_request(&tampered, KEY, 1_700_000_000),
            Err(ProvisionError::Unauthorized)
        ));
    }

    #[test]
    fn bind_policy_rejects_wrong_mode_and_reserved_subnets() {
        let mut request = bind_request(proxy_binding());
        request.lease.mode = "wireguard".to_string();
        request.lease.signature =
            sign_lease_with_binding(KEY, Action::Bind, &request.lease, request.binding.as_ref())
                .unwrap();
        assert!(matches!(
            validate_request(&request, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));

        let mut request = bind_request(proxy_binding());
        request.binding.as_mut().unwrap().subnet_octet = 255;
        request.lease.signature =
            sign_lease_with_binding(KEY, Action::Bind, &request.lease, request.binding.as_ref())
                .unwrap();
        assert!(matches!(
            validate_request(&request, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));
    }
}

pub fn namespace_for(model_id: &str) -> Result<String, ProvisionError> {
    validate_identifier("model_id", model_id, 1, 64)?;
    Ok(format!("egress_{model_id}"))
}

fn validate_key(key: &[u8]) -> Result<(), ProvisionError> {
    if key.len() < 32 {
        return Err(ProvisionError::Invalid(
            "lease key must be at least 32 bytes".to_string(),
        ));
    }
    Ok(())
}

fn validate_identifier(
    field: &str,
    value: &str,
    min: usize,
    max: usize,
) -> Result<(), ProvisionError> {
    if !(min..=max).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(ProvisionError::Invalid(format!("invalid {field}")));
    }
    Ok(())
}
