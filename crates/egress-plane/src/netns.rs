use std::io;
use std::process::Command;
use std::time::Duration;
use tracing::{error, info, warn, instrument};

/// Create a network namespace using `ip netns add`.
#[instrument]
pub fn create_netns(name: &str) -> io::Result<()> {
    let output = Command::new("ip")
        .args(["netns", "add", name])
        .output()?;

    if output.status.success() {
        info!(netns = %name, "Created network namespace");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(netns = %name, stderr = %stderr, "Failed to create network namespace");
        Err(io::Error::other(
            format!("ip netns add failed: {}", stderr.trim()),
        ))
    }
}

/// Delete a network namespace using `ip netns delete`.
#[instrument]
pub fn delete_netns(name: &str) -> io::Result<()> {
    let output = Command::new("ip")
        .args(["netns", "delete", name])
        .output()?;

    if output.status.success() {
        info!(netns = %name, "Deleted network namespace");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If the namespace doesn't exist, treat it as a success
        if stderr.contains("does not exist")
            || stderr.contains("Cannot find")
            || stderr.contains("not exist")
            || stderr.contains("No such file")
            || stderr.contains("Cannot remove")
        {
            warn!(netns = %name, "Network namespace did not exist");
            return Ok(());
        }
        error!(netns = %name, stderr = %stderr, "Failed to delete network namespace");
        Err(io::Error::other(
            format!("ip netns delete failed: {}", stderr.trim()),
        ))
    }
}

/// Set the default route to a null/blackhole in the given namespace.
/// This implements fail-closed: all egress is dropped by default.
/// Only explicitly allowed hosts (via iptables/nftables) can be reached.
#[instrument]
pub fn set_null_default_route(ns: &str) -> io::Result<()> {
    // Delete any existing default route first
    let _ = execute_in_netns(ns, &["ip", "route", "del", "default"]);

    // Add a blackhole route — all traffic to 0.0.0.0/0 is dropped
    let output = execute_in_netns(ns, &["ip", "route", "add", "blackhole", "default"]);
    match output {
        Ok(out) => {
            info!(netns = %ns, output = %out.trim(), "Set null default route (blackhole)");
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            // If it already exists, that's fine — we're already fail-closed
            if msg.contains("File exists") {
                warn!(netns = %ns, "Null default route already exists");
                return Ok(());
            }
            error!(netns = %ns, error = %msg, "Failed to set null default route");
            Err(e)
        }
    }
}

/// Add an allow-rule in the namespace to permit egress to a specific host.
/// Uses iptables in the target namespace: ACCEPT traffic to the host, then
/// sets a default DROP policy on the OUTPUT chain.
#[instrument]
pub fn add_allow_rule(ns: &str, host: &str) -> io::Result<()> {
    // Ensure the OUTPUT chain exists and has a default DROP policy
    let _ = execute_in_netns(ns, &["iptables", "-P", "OUTPUT", "DROP"]);

    // Add an ACCEPT rule for the specific host (insert at position 1)
    let output = execute_in_netns(
        ns,
        &["iptables", "-I", "OUTPUT", "1", "-d", host, "-j", "ACCEPT"],
    );
    match output {
        Ok(out) => {
            info!(netns = %ns, host = %host, output = %out.trim(), "Added allow rule");
            Ok(())
        }
        Err(e) => {
            error!(netns = %ns, host = %host, error = %e, "Failed to add allow rule");
            Err(e)
        }
    }
}

/// Flush all iptables rules in the namespace's OUTPUT chain.
/// Used by the kill-switch to block all egress immediately.
#[instrument]
pub fn flush_allow_rules(ns: &str) -> io::Result<()> {
    let output = execute_in_netns(ns, &["iptables", "-F", "OUTPUT"]);
    match output {
        Ok(out) => {
            info!(netns = %ns, output = %out.trim(), "Flushed all allow rules");
            // After flush, set DROP policy so fail-closed is maintained
            let _ = execute_in_netns(ns, &["iptables", "-P", "OUTPUT", "DROP"]);
            Ok(())
        }
        Err(e) => {
            error!(netns = %ns, error = %e, "Failed to flush allow rules");
            Err(e)
        }
    }
}

/// Execute a command inside a network namespace via `ip netns exec`.
/// Returns stdout as a String on success.
#[instrument]
pub fn execute_in_netns(ns: &str, cmd: &[&str]) -> io::Result<String> {
    let mut args = vec!["netns", "exec", ns];
    args.extend_from_slice(cmd);

    let output = Command::new("ip").args(&args).output()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let cmd_str = cmd.join(" ");
        error!(
            netns = %ns,
            cmd = %cmd_str,
            stderr = %stderr,
            "Command failed in network namespace"
        );
        Err(io::Error::other(
            format!("Command '{}' failed in netns '{}': {}", cmd_str, ns, stderr.trim()),
        ))
    }
}

/// Create a veth pair bridging the host namespace to a netns.
/// `host_ip` is assigned to the host-side interface (e.g. 10.240.0.1/30),
/// `ns_ip` to the netns-side (e.g. 10.240.0.2/30). The netns-side address is
/// where the per-model sidecar proxy listens; the host-side address is what
/// API/connector clients connect to. Interface names are derived from a hash
/// of the namespace name so distinct models never collide (and the 15-char
/// Linux ifname limit is respected). Returns the host-side address.
#[instrument]
pub fn setup_veth(ns: &str, host_ip: &str, ns_ip: &str) -> io::Result<String> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    ns.hash(&mut h);
    let tag = format!("{:08x}", h.finish() & 0xffff_ffff);
    let veth_host = format!("vh_{tag}");
    let veth_ns = format!("vn_{tag}");
    let _ = execute_in_netns(ns, &["ip", "link", "del", &veth_ns]);
    let _ = Command::new("ip").args(["link", "del", &veth_host]).output();

    let out = Command::new("ip")
        .args(["link", "add", &veth_host, "type", "veth", "peer", "name", &veth_ns])
        .output()?;
    if !out.status.success() {
        return Err(io::Error::other(format!(
            "veth pair creation failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    // Move the ns-side device into the namespace FROM the host side (the
    // device exists in the host namespace right after pair creation).
    let move_out = Command::new("ip")
        .args(["link", "set", &veth_ns, "netns", ns])
        .output()?;
    if !move_out.status.success() {
        let _ = Command::new("ip").args(["link", "del", &veth_host]).output();
        return Err(io::Error::other(format!(
            "veth move to netns failed: {}",
            String::from_utf8_lossy(&move_out.stderr).trim()
        )));
    }
    // The host-side address MUST be added before the interface goes up —
    // and it must not fail silently. `ip addr add` on an address that
    // already exists on ANOTHER interface returns "File exists"; ignoring
    // that leaves the veth without an address and the host route to the
    // netns-side .2 flows through a DIFFERENT (possibly live) bind — the
    // exact ambiguity that made the fail-closed regression test probe the
    // live chain. Propagate the error so the bind fails loudly.
    let addr_out = Command::new("ip")
        .args(["addr", "add", host_ip, "dev", &veth_host])
        .output()?;
    if !addr_out.status.success() {
        let _ = Command::new("ip").args(["link", "del", &veth_host]).output();
        return Err(io::Error::other(format!(
            "host veth addr add failed (subnet already in use?): {}",
            String::from_utf8_lossy(&addr_out.stderr).trim()
        )));
    }
    let _ = Command::new("ip").args(["link", "set", &veth_host, "up"]).output();
    execute_in_netns(ns, &["ip", "addr", "add", ns_ip, "dev", &veth_ns])?;
    execute_in_netns(ns, &["ip", "link", "set", &veth_ns, "up"])?;
    let _ = execute_in_netns(ns, &["ip", "link", "set", "lo", "up"]);

    info!(netns = %ns, veth_host = %veth_host, host_ip = %host_ip, ns_ip = %ns_ip, "veth pair ready");
    Ok(host_ip.to_string())
}

/// Remove a veth pair by host-side interface name (idempotent).
#[instrument]
pub fn teardown_veth(veth_host: &str) -> io::Result<()> {
    let output = Command::new("ip").args(["link", "del", veth_host]).output()?;
    if output.status.success() || String::from_utf8_lossy(&output.stderr).contains("does not exist") {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "veth teardown failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

/// Sweep orphaned egress-plane kernel state at startup: leftover `vh_*` veth
/// interfaces (from unclean shutdowns) and stale `egress_*` namespaces. Both
/// are recreated on demand at bind time. Without this sweep, an orphan veth
/// still holding a model's 10.240.x.1/30 address makes the next bind's
/// `ip addr add` fail silently (address exists) and breaks connectivity —
/// the exact class of stale-state bug that produced "No route to host".
pub fn sweep_orphans() {
    if let Ok(out) = Command::new("ip").args(["-o", "link", "show"]).output() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            // Format: "N: vh_xxxx: <FLAGS> ..."
            if let Some(name) = line
                .split(':')
                .nth(1)
                .map(|s| s.trim())
                .filter(|s| s.starts_with("vh_"))
            {
                let _ = Command::new("ip").args(["link", "del", name]).output();
            }
        }
    }
    if let Ok(out) = Command::new("ip").args(["netns", "list"]).output() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            let name = line.split_whitespace().next().unwrap_or("");
            if name.starts_with("egress_") {
                let _ = Command::new("ip").args(["netns", "del", name]).output();
            }
        }
    }
    info!("swept orphaned egress veths/namespaces");
}

/// Health-check a proxy by attempting a TCP connection to its address.
/// For HTTP proxies, also tries a GET /health if the TCP connect succeeds.
#[instrument]
pub async fn health_check_proxy(proxy_type: &str, addr: &str) -> Result<bool, String> {
    info!(proxy_type = %proxy_type, addr = %addr, "Health-checking proxy");

    // Parse address
    let socket_addr: std::net::SocketAddr = addr
        .parse()
        .map_err(|e| format!("Invalid address '{}': {}", addr, e))?;

    // TCP connect test with timeout
    let tcp_check = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::TcpStream::connect(socket_addr),
    )
    .await;

    match tcp_check {
        Ok(_stream) => {
            info!(proxy_type = %proxy_type, addr = %addr, "TCP connect succeeded");

            // For HTTP proxies, try an HTTP health check
            if proxy_type.eq_ignore_ascii_case("http") || proxy_type.eq_ignore_ascii_case("https") {
                let url = format!("http://{}/health", addr.trim_end_matches('/'));
                match reqwest::get(&url).await {
                    Ok(resp) if resp.status().is_success() => {
                        info!(addr = %addr, "HTTP proxy health check passed");
                        return Ok(true);
                    }
                    Ok(resp) => {
                        warn!(addr = %addr, status = %resp.status(), "HTTP proxy health check returned non-success");
                        return Ok(false);
                    }
                    Err(e) => {
                        warn!(addr = %addr, error = %e, "HTTP proxy health check connection failed");
                        return Ok(false);
                    }
                }
            }

            Ok(true)
        }
        Err(e) => {
            warn!(
                proxy_type = %proxy_type,
                addr = %addr,
                error = %e,
                "TCP connect to proxy failed"
            );
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_delete_netns() {
        let name = format!("test_ns_{}", std::process::id());
        let _ = delete_netns(&name); // Clean up any leftover
        let result = create_netns(&name);
        if result.is_ok() {
            let _ = delete_netns(&name);
        }
        // If not root, the command fails with a permission error — that's acceptable
    }

    #[test]
    fn test_delete_nonexistent_netns() {
        let result = delete_netns("nonexistent_ns_99999");
        // Should succeed because we handle "does not exist" gracefully
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_in_netns_no_ns() {
        let result = execute_in_netns("nonexistent_ns_88888", &["echo", "hello"]);
        assert!(result.is_err());
    }
}
