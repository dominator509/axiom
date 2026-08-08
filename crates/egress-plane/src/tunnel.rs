//! Tunnel bring-up for `wireguard` and `vpn` egress modes (L2.6).
//!
//! The tunnel interface is created INSIDE the model's network namespace, so
//! the namespace's only route to the outside world is the tunnel. There is no
//! default route on the host side of the namespace boundary; a down tunnel
//! means no egress at all — fail-closed by construction (LBI-02).
//!
//! `vpn` mode uses the same WireGuard-protocol tunnel machinery with a full
//! tunnel config (self-hosted WG-based VPN provider configs). Both modes are
//! enforced identically by the namespace routing.

use std::io;
use tracing::{info, instrument, warn};

use crate::config::NetworkConfig;

/// Interface name used for the tunnel inside the netns.
pub const TUNNEL_IFACE: &str = "egr0";

/// A parsed tunnel config: interface address(es), peer public key, endpoint,
/// allowed IPs and keepalive. Sanitized before any shell/ip invocation.
#[derive(Debug, Clone)]
pub struct TunnelSpec {
    pub iface_addr: String,
    pub peer_pubkey: String,
    pub endpoint: String,
    pub allowed_ips: String,
    pub keepalive: Option<i32>,
}

impl TunnelSpec {
    /// Parse from a raw NetworkConfig + decrypted private key.
    /// `iface_addr` is derived from the allowed-ips' first /32 for simplicity
    /// — production configs may pin it explicitly in the creds envelope.
    pub fn from_config(
        cfg: &NetworkConfig,
        private_key: &str,
        iface_addr: &str,
    ) -> Result<Self, String> {
        let peer_pubkey = cfg
            .wg_public_key
            .as_deref()
            .ok_or("wireguard mode requires wg_public_key")?;
        let endpoint = cfg
            .wg_endpoint
            .as_deref()
            .ok_or("wireguard mode requires wg_endpoint")?;
        let allowed_ips = cfg.wg_allowed_ips.as_deref().unwrap_or("0.0.0.0/0");

        // Validate the private key the same way as any WG key (44 base64 chars).
        NetworkConfig::sanitize_key(private_key)?;
        NetworkConfig::sanitize_key(peer_pubkey)?;
        let endpoint = NetworkConfig::sanitize_hostport(endpoint)?;
        let allowed_ips = NetworkConfig::sanitize_cidrs(allowed_ips)?;
        if !iface_addr.contains('/') || iface_addr.starts_with('-') {
            return Err("invalid tunnel interface address".to_string());
        }

        Ok(TunnelSpec {
            iface_addr: iface_addr.to_string(),
            peer_pubkey: peer_pubkey.to_string(),
            endpoint,
            allowed_ips,
            keepalive: cfg.wg_persistent_keepalive,
        })
    }
}

/// Bring up the WireGuard tunnel inside the model's netns.
/// Steps (all executed inside the namespace via `ip netns exec`):
///   1. create the wireguard interface
///   2. set the private key + peer (pubkey, endpoint, allowed-ips, keepalive)
///   3. assign the tunnel address
///   4. bring the interface up (route via allowed-ips is automatic)
#[instrument(skip_all)]
pub fn bring_up_tunnel(
    ns: &str,
    spec: &TunnelSpec,
    private_key: &str,
    preshared_key: Option<&str>,
) -> io::Result<()> {
    let exec = |args: &[&str]| -> io::Result<String> { crate::netns::execute_in_netns(ns, args) };

    // Create the interface.
    exec(&["ip", "link", "add", TUNNEL_IFACE, "type", "wireguard"])?;

    // Configure the private key. wg-quick uses a file; `wg set` accepts the
    // key on stdin. Use the file-based form to avoid the key appearing in
    // process argv (it would be visible in /proc).
    let key_file = format!("/tmp/wg_priv_{}", ns);
    std::fs::write(&key_file, private_key.as_bytes())?;
    let mut args: Vec<String> = vec![
        "wg".into(),
        "set".into(),
        TUNNEL_IFACE.into(),
        "private-key".into(),
        key_file.clone(),
    ];
    if let Some(psk) = preshared_key {
        let psk_file = format!("/tmp/wg_psk_{}", ns);
        std::fs::write(&psk_file, psk.as_bytes())?;
        args.extend(["preshared-key".into(), psk_file.clone()]);
        let _ = std::fs::remove_file(&psk_file);
    }
    args.extend([
        "peer".into(),
        spec.peer_pubkey.clone(),
        "endpoint".into(),
        spec.endpoint.clone(),
        "allowed-ips".into(),
        spec.allowed_ips.clone(),
    ]);
    if let Some(k) = spec.keepalive {
        let ks = k.to_string();
        args.extend(["persistent-keepalive".into(), ks]);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let _ = exec(&arg_refs);
    let _ = std::fs::remove_file(&key_file);

    // Assign the tunnel address and bring it up.
    exec(&[
        "ip",
        "address",
        "add",
        &spec.iface_addr,
        "dev",
        TUNNEL_IFACE,
    ])?;
    exec(&["ip", "link", "set", TUNNEL_IFACE, "up"])?;

    // wg-quick semantics: the kernel does NOT add allowed-ips routes until
    // the peer is (re)applied while the interface is up, so add them
    // explicitly. Each comma/space-separated CIDR gets a route via the tunnel.
    for cidr in spec.allowed_ips.split([',', ' ']).filter(|c| !c.is_empty()) {
        let _ = exec(&["ip", "route", "add", cidr, "dev", TUNNEL_IFACE]);
    }

    info!(netns = %ns, iface = %TUNNEL_IFACE, endpoint = %spec.endpoint, "WireGuard tunnel up");
    Ok(())
}

/// Remove the tunnel interface from the namespace (idempotent).
#[instrument]
pub fn teardown_tunnel(ns: &str) -> io::Result<()> {
    let _ = crate::netns::execute_in_netns(ns, &["ip", "link", "del", TUNNEL_IFACE]);
    info!(netns = %ns, "Tunnel interface removed");
    Ok(())
}

/// Query the tunnel interface for a handshake (WireGuard only) — used by
/// health checks to prove the tunnel is actually up, not just configured.
pub fn tunnel_has_handshake(ns: &str) -> bool {
    match crate::netns::execute_in_netns(ns, &["wg", "show", TUNNEL_IFACE, "latest-handshakes"]) {
        Ok(out) => {
            // Format: <peer-pubkey>\t<unix-seconds>; non-zero time = handshake.
            out.split_whitespace()
                .nth(1)
                .map(|t| t != "0")
                .unwrap_or(false)
        }
        Err(e) => {
            warn!(netns = %ns, error = %e, "wg show failed");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EgressMode, NetworkConfig};

    fn base_cfg() -> NetworkConfig {
        NetworkConfig {
            model_id: "m1".to_string(),
            org_id: "o1".to_string(),
            mode: EgressMode::WireGuard,
            proxy_addr: None,
            wg_public_key: Some("S9r2v8sTqFm9W1zVZ6t0j5gZqQyHnYjQeWtXnWmVsUc=".to_string()),
            wg_endpoint: Some("vpn.example.com:51820".to_string()),
            wg_allowed_ips: Some("0.0.0.0/0".to_string()),
            wg_persistent_keepalive: Some(25),
            expected_egress_ip: None,
            failover_proxy_addrs: vec![],
            enc_creds: None,
            enc_nonce: None,
            dek_id: None,
        }
    }

    #[test]
    fn tunnel_spec_parses() {
        let cfg = base_cfg();
        let spec = TunnelSpec::from_config(
            &cfg,
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "10.7.0.2/32",
        )
        .unwrap();
        assert_eq!(spec.peer_pubkey, cfg.wg_public_key.unwrap());
        assert_eq!(spec.endpoint, "vpn.example.com:51820");
        assert_eq!(spec.allowed_ips, "0.0.0.0/0");
        assert_eq!(spec.keepalive, Some(25));
    }

    #[test]
    fn tunnel_spec_rejects_unsafe_input() {
        let mut cfg = base_cfg();
        cfg.wg_endpoint = Some("$(evil)".to_string());
        assert!(TunnelSpec::from_config(
            &cfg,
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "10.7.0.2/32"
        )
        .is_err());

        let mut cfg2 = base_cfg();
        cfg2.wg_public_key = None;
        assert!(TunnelSpec::from_config(
            &cfg2,
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "10.7.0.2/32"
        )
        .is_err());
    }
}
