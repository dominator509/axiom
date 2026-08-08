//! Egress configuration types (L2.6).
//!
//! Mirrors the `model_network_configs` table: egress mode, proxy/tunnel
//! settings, expected-IP drift policy, approved failover egress, and an
//! envelope-encrypted credentials blob (proxy user/pass, WG private key +
//! preshared, VPN config) that is decrypted in-memory and zeroized after use.

use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

/// Supported per-model egress modes (L2.6: direct | socks5 | http | https |
/// wireguard | vpn). `direct` is an explicit opt-in with NO isolation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EgressMode {
    Direct,
    Socks5,
    Http,
    Https,
    WireGuard,
    Vpn,
}

#[allow(clippy::should_implement_trait)]
impl EgressMode {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "direct" => Some(EgressMode::Direct),
            "socks5" => Some(EgressMode::Socks5),
            "http" => Some(EgressMode::Http),
            "https" => Some(EgressMode::Https),
            "wireguard" => Some(EgressMode::WireGuard),
            "vpn" => Some(EgressMode::Vpn),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            EgressMode::Direct => "direct",
            EgressMode::Socks5 => "socks5",
            EgressMode::Http => "http",
            EgressMode::Https => "https",
            EgressMode::WireGuard => "wireguard",
            EgressMode::Vpn => "vpn",
        }
    }

    pub fn is_tunnel(&self) -> bool {
        matches!(self, EgressMode::WireGuard | EgressMode::Vpn)
    }

    pub fn is_proxy(&self) -> bool {
        matches!(
            self,
            EgressMode::Socks5 | EgressMode::Http | EgressMode::Https
        )
    }
}

/// Decrypted credentials from the envelope (`enc_creds`). This struct must
/// NEVER be logged or persisted; call `.zeroize()` after use (LBI-05).
#[derive(Debug, Clone, Default, Serialize, Deserialize, Zeroize)]
#[zeroize(drop)]
pub struct Creds {
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
}

/// A fully-resolved per-model egress config (the Rust-side mirror of a
/// `model_network_configs` row with the envelope decrypted).
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub model_id: String,
    pub org_id: String,
    pub mode: EgressMode,
    /// External proxy host:port (proxy modes). This is the model's approved
    /// egress proxy; the netns allow-list only ever admits this host.
    pub proxy_addr: Option<String>,
    /// WireGuard tunnel parameters (wireguard/vpn modes).
    pub wg_public_key: Option<String>,
    pub wg_endpoint: Option<String>,
    pub wg_allowed_ips: Option<String>,
    pub wg_persistent_keepalive: Option<i32>,
    /// Drift policy: if the echo endpoint reports a different IP, warn.
    pub expected_egress_ip: Option<String>,
    /// Approved alternate egress proxies; used only on health-gated failover,
    /// never as a host-route fallback (LBI-02).
    pub failover_proxy_addrs: Vec<String>,
    /// Envelope-encrypted blob (raw from DB; decrypted on demand).
    pub enc_creds: Option<Vec<u8>>,
    pub enc_nonce: Option<Vec<u8>>,
    pub dek_id: Option<String>,
}

impl NetworkConfig {
    /// Sanitize the WG endpoint for safe shell/ip invocation: allow only
    /// hostnames, IPv4/IPv6 and a port suffix.
    pub fn sanitize_hostport(hostport: &str) -> Result<String, String> {
        let ok = hostport.len() <= 255
            && hostport
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == ':' || c == '-' || c == '_');
        if !ok {
            return Err(format!("unsafe hostport: {hostport}"));
        }
        Ok(hostport.to_string())
    }

    pub fn sanitize_cidrs(cidrs: &str) -> Result<String, String> {
        let ok = cidrs.len() <= 512
            && cidrs
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '/' || c == ',' || c == ' ');
        if !ok {
            return Err(format!("unsafe cidrs: {cidrs}"));
        }
        Ok(cidrs.to_string())
    }

    pub fn sanitize_key(key: &str) -> Result<String, String> {
        // WireGuard keys are exactly 44 base64 chars.
        if key.len() == 44
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
        {
            Ok(key.to_string())
        } else {
            Err("invalid wireguard key length/format".to_string())
        }
    }

    /// The name of the enforcement namespace for this model.
    pub fn netns_name(&self) -> String {
        format!(
            "egress_{}",
            self.model_id
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '_' {
                    c
                } else {
                    '_'
                })
                .collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_roundtrip() {
        for (s, m) in [
            ("direct", EgressMode::Direct),
            ("socks5", EgressMode::Socks5),
            ("http", EgressMode::Http),
            ("https", EgressMode::Https),
            ("wireguard", EgressMode::WireGuard),
            ("vpn", EgressMode::Vpn),
        ] {
            assert_eq!(EgressMode::from_str(s), Some(m));
            assert_eq!(m.as_str(), s);
        }
        assert_eq!(EgressMode::from_str("bogus"), None);
        assert_eq!(EgressMode::from_str("DIRECT"), Some(EgressMode::Direct));
    }

    #[test]
    fn mode_classes() {
        assert!(EgressMode::WireGuard.is_tunnel());
        assert!(EgressMode::Vpn.is_tunnel());
        assert!(!EgressMode::Direct.is_tunnel());
        assert!(EgressMode::Socks5.is_proxy());
        assert!(EgressMode::Http.is_proxy());
        assert!(EgressMode::Https.is_proxy());
    }

    #[test]
    fn sanitizers() {
        assert_eq!(
            NetworkConfig::sanitize_hostport("proxy.example.com:3128").unwrap(),
            "proxy.example.com:3128"
        );
        assert!(NetworkConfig::sanitize_hostport("$(rm -rf /)").is_err());
        assert_eq!(
            NetworkConfig::sanitize_cidrs("0.0.0.0/0, 10.0.0.0/8").unwrap(),
            "0.0.0.0/0, 10.0.0.0/8"
        );
        assert!(NetworkConfig::sanitize_cidrs("0.0.0.0/0; rm -rf /").is_err());
        assert!(
            NetworkConfig::sanitize_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").is_ok()
        );
        assert!(NetworkConfig::sanitize_key("short").is_err());
    }

    #[test]
    fn netns_name_sanitized() {
        let cfg = NetworkConfig {
            model_id: "m1/../evil".to_string(),
            org_id: "o1".to_string(),
            mode: EgressMode::Direct,
            proxy_addr: None,
            wg_public_key: None,
            wg_endpoint: None,
            wg_allowed_ips: None,
            wg_persistent_keepalive: None,
            expected_egress_ip: None,
            failover_proxy_addrs: vec![],
            enc_creds: None,
            enc_nonce: None,
            dek_id: None,
        };
        assert_eq!(cfg.netns_name(), "egress_m1____evil");
    }
}
