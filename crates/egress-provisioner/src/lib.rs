//! Root-owned, local-only model namespace provisioner.
//!
//! The provisioner intentionally accepts a tiny typed lifecycle protocol. It
//! never accepts a command line, path, route, interface name, provider URL or
//! raw namespace name from the caller. Namespace identity is derived from a
//! signed, bounded model lease; namespace creation starts fail-closed with
//! blackhole defaults and both IPv4/IPv6 policy DROP.

use base64::Engine as _;
use egress_plane::{config::EgressMode, netns};
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

pub const PROTOCOL: &str = "AXIOM_EGRESS_PROVISIONER_V1";
const MAX_LEASE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Create,
    Inspect,
    Release,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: String,
    pub request_id: String,
    pub action: Action,
    pub lease: Lease,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Response {
    pub request_id: String,
    pub status: String,
    pub namespace: String,
    pub mode: String,
    pub default_deny: bool,
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

pub fn sign_lease(key: &[u8], action: Action, lease: &Lease) -> Result<String, ProvisionError> {
    validate_key(key)?;
    let signature = hmac::sign(
        &hmac::Key::new(hmac::HMAC_SHA256, key),
        lease_payload(action, lease).as_bytes(),
    );
    Ok(base64::engine::general_purpose::STANDARD.encode(signature.as_ref()))
}

pub fn validate_request(
    request: &Request,
    key: &[u8],
    now: u64,
) -> Result<EgressMode, ProvisionError> {
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
    let mode = EgressMode::from_str(&request.lease.mode)
        .ok_or_else(|| ProvisionError::Invalid("unsupported egress mode".to_string()))?;
    let supplied = base64::engine::general_purpose::STANDARD
        .decode(&request.lease.signature)
        .map_err(|_| ProvisionError::Unauthorized)?;
    hmac::verify(
        &hmac::Key::new(hmac::HMAC_SHA256, key),
        lease_payload(request.action, &request.lease).as_bytes(),
        &supplied,
    )
    .map_err(|_| ProvisionError::Unauthorized)?;
    Ok(mode)
}

pub fn namespace_for(model_id: &str) -> Result<String, ProvisionError> {
    validate_identifier("model_id", model_id, 1, 64)?;
    Ok(format!("egress_{model_id}"))
}

/// Apply one signed lifecycle operation. Direct mode is intentionally rejected
/// for `create`: it has no namespace and must never consume root privileges.
pub fn apply(request: &Request, key: &[u8], now: u64) -> Result<Response, ProvisionError> {
    let mode = validate_request(request, key, now)?;
    if mode == EgressMode::Direct {
        return Err(ProvisionError::Invalid(
            "direct mode does not have a provisioned namespace".to_string(),
        ));
    }
    let namespace = namespace_for(&request.lease.model_id)?;
    match request.action {
        Action::Create => {
            create_default_deny_namespace(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "created".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
        Action::Inspect => {
            inspect_default_deny_namespace(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "ready".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
        Action::Release => {
            netns::delete_netns(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "released".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
    }
}

fn create_default_deny_namespace(namespace: &str) -> Result<(), ProvisionError> {
    netns::create_netns(namespace)?;
    let setup = (|| -> Result<(), std::io::Error> {
        netns::execute_in_netns(namespace, &["ip", "link", "set", "lo", "up"])?;
        netns::set_null_default_route(namespace)?;
        // The provisioner does not accept a caller-selected gateway or port.
        // It starts from a closed firewall; a later typed attach operation may
        // add exactly the persisted model path before a runner receives a lease.
        netns::configure_default_deny_firewall(namespace)?;
        Ok(())
    })();
    if let Err(error) = setup {
        let _ = netns::delete_netns(namespace);
        return Err(error.into());
    }
    inspect_default_deny_namespace(namespace)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn request(action: Action) -> Request {
        let mut lease = Lease {
            org_id: "org_1".to_string(),
            model_id: "model_1".to_string(),
            mode: "wireguard".to_string(),
            nonce: "nonce_for_test_0001".to_string(),
            expires_unix: 1_700_000_100,
            signature: String::new(),
        };
        lease.signature = sign_lease(KEY, action, &lease).unwrap();
        Request {
            protocol: PROTOCOL.to_string(),
            request_id: "request_for_test_0001".to_string(),
            action,
            lease,
        }
    }

    #[test]
    fn valid_signed_request_has_a_deterministic_namespace() {
        let request = request(Action::Create);
        assert_eq!(
            validate_request(&request, KEY, 1_700_000_000).unwrap(),
            EgressMode::WireGuard
        );
        assert_eq!(
            namespace_for(&request.lease.model_id).unwrap(),
            "egress_model_1"
        );
    }

    #[test]
    fn lease_rejects_tampering_expiry_and_unsafe_identity() {
        let mut tampered = request(Action::Create);
        tampered.lease.model_id = "model_2".to_string();
        assert!(matches!(
            validate_request(&tampered, KEY, 1_700_000_000),
            Err(ProvisionError::Unauthorized)
        ));

        let mut expired = request(Action::Create);
        expired.lease.expires_unix = 1_699_999_999;
        assert!(matches!(
            validate_request(&expired, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));

        let mut unsafe_identity = request(Action::Create);
        unsafe_identity.lease.model_id = "model/../../host".to_string();
        assert!(matches!(
            validate_request(&unsafe_identity, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[test]
    fn direct_mode_never_requests_root_namespace_lifecycle() {
        let mut direct = request(Action::Create);
        direct.lease.mode = "direct".to_string();
        direct.lease.signature = sign_lease(KEY, Action::Create, &direct.lease).unwrap();
        assert!(matches!(
            apply(&direct, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[test]
    fn replay_registry_reserves_each_validated_nonce_once() {
        let registry = ReplayRegistry::default();
        let request = request(Action::Create);
        validate_request(&request, KEY, 1_700_000_000).unwrap();
        registry.reserve(&request.lease.nonce).unwrap();
        assert!(matches!(
            registry.reserve(&request.lease.nonce),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn signed_lifecycle_creates_inspects_and_releases_a_closed_namespace() {
        assert_eq!(
            std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref(),
            Ok("1"),
            "this test must run only in the isolated Linux rehearsal"
        );
        let now = now_unix().unwrap();
        let model_id = format!("provisioner_{}", std::process::id());
        let build_request = |action: Action, nonce: &str| {
            let mut lease = Lease {
                org_id: "isolated_org".to_string(),
                model_id: model_id.clone(),
                mode: "wireguard".to_string(),
                nonce: nonce.to_string(),
                expires_unix: now + 60,
                signature: String::new(),
            };
            lease.signature = sign_lease(KEY, action, &lease).unwrap();
            Request {
                protocol: PROTOCOL.to_string(),
                request_id: format!("request_{nonce}"),
                action,
                lease,
            }
        };
        let create = build_request(Action::Create, "create_nonce_0001");
        let inspect = build_request(Action::Inspect, "inspect_nonce_0001");
        let release = build_request(Action::Release, "release_nonce_0001");
        let namespace = namespace_for(&model_id).unwrap();
        let _ = netns::delete_netns(&namespace);
        assert_eq!(apply(&create, KEY, now).unwrap().status, "created");
        assert_eq!(apply(&inspect, KEY, now).unwrap().status, "ready");
        assert_eq!(apply(&release, KEY, now).unwrap().status, "released");
    }
}
