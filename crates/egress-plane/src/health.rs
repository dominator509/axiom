//! Echo-IP health checks (L2.6 §Health monitoring).
//!
//! Every check runs THROUGH the model's bound egress (sidecar proxy in the
//! netns), so a pass proves the entire path: client → sidecar → netns →
//! tunnel/external-proxy → echo endpoint. The reported egress IP is compared
//! against the model's expected-IP policy; drift is surfaced to the Network &
//! Security tab and Prometheus. A failing tunnel never falls back to the host
//! route — the check simply fails (LBI-02).

use std::time::{Duration, Instant};
use tracing::{info, warn};

#[derive(Debug, Clone, Default)]
pub struct HealthState {
    pub healthy: bool,
    pub last_check: Option<String>, // ISO-8601 UTC
    pub latency_ms: Option<u64>,
    pub egress_ip: Option<String>,
    pub fail_count: u32,
    pub drift: bool,
    pub last_error: Option<String>,
}

/// Result of one echo-IP probe.
#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub ok: bool,
    pub egress_ip: Option<String>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// Extract an IPv4/IPv6 address from an echo endpoint body.
/// Accepts a bare IP, `{"ip":"1.2.3.4"}`, or `ip=1.2.3.4`.
pub fn parse_echo_ip(body: &str) -> Option<String> {
    let trimmed = body.trim();
    // JSON {"ip":"..."} / {"address":"..."}
    for key in ["\"ip\"", "\"address\"", "\"query\""] {
        if let Some(idx) = trimmed.find(key) {
            let after = &trimmed[idx + key.len()..];
            if let Some(colon) = after.find(':') {
                let rest = after[colon + 1..].trim();
                let start = rest.trim_start_matches(['"', ' ']);
                let ip: String = start
                    .chars()
                    .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ':' || *c == '[' || *c == ']' || *c == 'a' || *c == 'b' || *c == 'c' || *c == 'd' || *c == 'e' || *c == 'f' || *c == 'A' || *c == 'B' || *c == 'C' || *c == 'D' || *c == 'E' || *c == 'F')
                    .collect();
                if !ip.is_empty() {
                    return Some(ip);
                }
            }
        }
    }
    // Bare IP (possibly with trailing whitespace/newline) — allow IPv6 hex.
    let candidate: String = trimmed
        .chars()
        .take_while(|c| {
            c.is_ascii_digit()
                || *c == '.'
                || *c == ':'
                || *c == '['
                || *c == ']'
                || c.is_ascii_hexdigit()
        })
        .collect();
    if candidate.contains('.') || candidate.contains(':') {
        return Some(candidate);
    }
    None
}

/// Probe the echo endpoint through an HTTP proxy address (the model's
/// sidecar). `proxy_addr: Option<(String, u16)>` — host-side veth IP + port.
/// When `None` (direct mode), probe without a proxy.
pub async fn probe_echo(
    echo_url: &str,
    proxy: Option<(&str, u16)>,
    timeout: Duration,
) -> ProbeResult {
    let started = Instant::now();
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(5)));
    if let Some((host, port)) = proxy {
        let proxy_url = format!("http://{host}:{port}");
        match reqwest::Proxy::http(&proxy_url) {
            Ok(p) => {
                builder = builder.proxy(p);
            }
            Err(e) => {
                return ProbeResult {
                    ok: false,
                    egress_ip: None,
                    latency_ms: 0,
                    error: Some(format!("invalid proxy url: {e}")),
                };
            }
        }
    }
    let client = match builder.build() {
        Ok(c) => c,
        Err(e) => {
            return ProbeResult {
                ok: false,
                egress_ip: None,
                latency_ms: 0,
                error: Some(format!("client build failed: {e}")),
            };
        }
    };

    match client.get(echo_url).send().await {
        Ok(resp) => {
            let latency = started.elapsed().as_millis() as u64;
            match resp.text().await {
                Ok(body) => match parse_echo_ip(&body) {
                    Some(ip) => ProbeResult {
                        ok: true,
                        egress_ip: Some(ip),
                        latency_ms: latency,
                        error: None,
                    },
                    None => ProbeResult {
                        ok: false,
                        egress_ip: None,
                        latency_ms: latency,
                        error: Some(format!("echo body had no IP: {}", truncate(&body, 120))),
                    },
                },
                Err(e) => ProbeResult {
                    ok: false,
                    egress_ip: None,
                    latency_ms: latency,
                    error: Some(format!("echo body read failed: {e}")),
                },
            }
        }
        Err(e) => ProbeResult {
            ok: false,
            egress_ip: None,
            latency_ms: started.elapsed().as_millis() as u64,
            error: Some(format!("echo request failed: {e}")),
        },
    }
}

fn truncate(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        out.push('…');
    }
    out
}

/// Reconcile a probe result into a HealthState, applying the expected-IP
/// drift policy. Returns the updated state.
pub fn reconcile_health(
    prev: &HealthState,
    result: &ProbeResult,
    expected_egress_ip: Option<&str>,
    now_iso: &str,
) -> HealthState {
    let drift = match (expected_egress_ip, &result.egress_ip) {
        (Some(expected), Some(actual)) => expected.trim() != actual.trim(),
        (Some(_), None) => true,
        (None, _) => false,
    };
    let fail_count = if result.ok { 0 } else { prev.fail_count.saturating_add(1) };
    if result.ok {
        info!(egress_ip = ?result.egress_ip, latency_ms = result.latency_ms, drift = drift, "egress health probe OK");
    } else {
        warn!(error = ?result.error, "egress health probe FAILED");
    }
    HealthState {
        healthy: result.ok,
        last_check: Some(now_iso.to_string()),
        latency_ms: Some(result.latency_ms),
        egress_ip: result.egress_ip.clone(),
        fail_count,
        drift,
        last_error: result.error.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bare_ip() {
        assert_eq!(parse_echo_ip("1.2.3.4\n"), Some("1.2.3.4".to_string()));
        assert_eq!(parse_echo_ip("203.0.113.7"), Some("203.0.113.7".to_string()));
        assert_eq!(parse_echo_ip("2605:a141:2335:7656::1"), Some("2605:a141:2335:7656::1".to_string()));
    }

    #[test]
    fn parse_json_ip() {
        assert_eq!(parse_echo_ip(r#"{"ip":"9.9.9.9"}"#), Some("9.9.9.9".to_string()));
        assert_eq!(parse_echo_ip(r#"{"address":"1.1.1.1"}"#), Some("1.1.1.1".to_string()));
        assert_eq!(parse_echo_ip(r#"{"query":"8.8.8.8"}"#), Some("8.8.8.8".to_string()));
    }

    #[test]
    fn parse_no_ip() {
        assert_eq!(parse_echo_ip("not an ip"), None);
        assert_eq!(parse_echo_ip(""), None);
    }

    #[test]
    fn reconcile_marks_drift() {
        let prev = HealthState::default();
        let now = "2026-08-06T00:00:00Z";
        let ok = ProbeResult { ok: true, egress_ip: Some("5.5.5.5".into()), latency_ms: 42, error: None };
        let st = reconcile_health(&prev, &ok, Some("5.5.5.5"), now);
        assert!(st.healthy);
        assert!(!st.drift);
        assert_eq!(st.fail_count, 0);

        let drift = reconcile_health(&st, &ok, Some("6.6.6.6"), now);
        assert!(drift.drift);
        assert_eq!(drift.fail_count, 0); // drift is a warning, not a failure

        let bad = ProbeResult { ok: false, egress_ip: None, latency_ms: 0, error: Some("timeout".into()) };
        let fail = reconcile_health(&st, &bad, None, now);
        assert!(!fail.healthy);
        assert_eq!(fail.fail_count, 1);
    }
}
