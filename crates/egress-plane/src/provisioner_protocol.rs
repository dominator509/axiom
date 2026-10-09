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

pub const PROTOCOL: &str = "AXIOM_EGRESS_PROVISIONER_V1";
pub const MAX_LEASE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Create,
    Inspect,
    Release,
}

impl Action {
    pub fn as_str(self) -> &'static str {
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
