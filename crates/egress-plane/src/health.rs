//! Echo-IP health checks (L2.6 §Health monitoring).
//!
//! Every check runs THROUGH the model's bound egress (sidecar proxy in the
//! netns), so a pass proves the entire path: client → sidecar → netns →
//! tunnel/external-proxy → echo endpoint. The reported egress IP is compared
//! against the model's expected-IP policy; drift is surfaced to the Network &
//! Security tab and Prometheus. A failing tunnel never falls back to the host
//! route — the check simply fails (LBI-02).

use std::time::{Duration, Instant};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tracing::{info, warn};

pub fn monitor_interval(value: Option<&str>) -> Result<Duration, &'static str> {
    let seconds = match value {
        None => 30,
        Some(value) => value
            .parse::<u64>()
            .map_err(|_| "invalid EGRESS_HEALTH_INTERVAL_SECS")?,
    };
    if !(1..=3600).contains(&seconds) {
        return Err("EGRESS_HEALTH_INTERVAL_SECS must be 1..3600");
    }
    Ok(Duration::from_secs(seconds))
}

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
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        for key in ["ip", "address", "query"] {
            if let Some(ip) = value.get(key).and_then(|v| v.as_str()) {
                return ip.parse::<std::net::IpAddr>().ok().map(|ip| ip.to_string());
            }
        }
    }
    trimmed
        .strip_prefix("ip=")
        .unwrap_or(trimmed)
        .parse::<std::net::IpAddr>()
        .ok()
        .map(|ip| ip.to_string())
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
    let client = match probe_client(proxy, timeout) {
        Ok(client) => client,
        Err(error) => {
            return ProbeResult {
                ok: false,
                egress_ip: None,
                latency_ms: 0,
                error: Some(error.into()),
            }
        }
    };

    match client.get(echo_url).send().await {
        Ok(mut resp) => {
            let latency = started.elapsed().as_millis() as u64;
            let read_body = async {
                if !resp.status().is_success() {
                    return Err("echo returned a non-success status");
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = resp.chunk().await.map_err(|_| "echo body read failed")? {
                    if bytes.len() + chunk.len() > 4096 {
                        return Err("echo body exceeds size limit");
                    }
                    bytes.extend_from_slice(&chunk);
                }
                String::from_utf8(bytes).map_err(|_| "echo body is not UTF-8")
            }
            .await;
            match read_body {
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
                        error: Some("echo body had no valid IP".into()),
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
        Err(_) => ProbeResult {
            ok: false,
            egress_ip: None,
            latency_ms: started.elapsed().as_millis() as u64,
            error: Some("echo request failed".into()),
        },
    }
}

// Reusing clients avoids repeatedly loading trust roots and rebuilding the
// HTTP stack for every periodic check. Cache the transport, NEVER health or
// echo results. Each proxy/timeout is a distinct key; no implicit direct entry.
fn probe_client(
    proxy: Option<(&str, u16)>,
    timeout: Duration,
) -> Result<reqwest::Client, &'static str> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, reqwest::Client>>> = OnceLock::new();
    let key = format!("{proxy:?}/{timeout:?}");
    let clients = CLIENTS.get_or_init(Default::default);
    if let Some(client) = clients.lock().unwrap().get(&key).cloned() {
        return Ok(client);
    }
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(5)));
    if let Some((host, port)) = proxy {
        let proxy_url = format!("http://{host}:{port}");
        // Proxy::all() — NOT Proxy::http(). With only Proxy::http(), an
        // https:// echo URL (e.g. api.ipify.org) bypasses the proxy and the
        // probe silently measures the HOST route — a fail-open. all() routes
        // https through the sidecar via CONNECT, so the probe genuinely
        // measures the model's egress chain (LBI-02).
        match reqwest::Proxy::all(&proxy_url) {
            Ok(p) => {
                builder = builder.proxy(p);
            }
            Err(_) => return Err("invalid proxy url"),
        }
    }
    let client = builder.build().map_err(|_| "client build failed")?;
    let mut clients = clients.lock().unwrap();
    if clients.len() >= 256 {
        clients.clear();
    }
    clients.insert(key, client.clone());
    Ok(client)
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
    let fail_count = if result.ok {
        0
    } else {
        prev.fail_count.saturating_add(1)
    };
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
    fn monitor_interval_is_bounded_and_never_silently_disabled() {
        assert_eq!(monitor_interval(None).unwrap(), Duration::from_secs(30));
        assert_eq!(monitor_interval(Some("5")).unwrap(), Duration::from_secs(5));
        for invalid in ["", "0", "-1", "3601", "NaN"] {
            assert!(monitor_interval(Some(invalid)).is_err());
        }
    }

    #[tokio::test]
    async fn probe_rejects_errors_redirects_and_oversized_bodies() {
        let app = axum::Router::new()
            .route(
                "/error",
                axum::routing::get(|| async {
                    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "127.0.0.1")
                }),
            )
            .route(
                "/oversized",
                axum::routing::get(|| async { "x".repeat(4097) }),
            )
            .route(
                "/redirect",
                axum::routing::get(|| async { axum::response::Redirect::temporary("/ok") }),
            )
            .route("/ok", axum::routing::get(|| async { "127.0.0.1" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        assert!(
            probe_echo(&format!("http://{addr}/ok"), None, Duration::from_secs(1))
                .await
                .ok
        );
        for path in ["error", "oversized", "redirect"] {
            assert!(
                !probe_echo(
                    &format!("http://{addr}/{path}"),
                    None,
                    Duration::from_secs(1)
                )
                .await
                .ok
            );
        }
        server.abort();
    }

    #[test]
    fn parse_bare_ip() {
        assert_eq!(parse_echo_ip("1.2.3.4\n"), Some("1.2.3.4".to_string()));
        assert_eq!(
            parse_echo_ip("203.0.113.7"),
            Some("203.0.113.7".to_string())
        );
        assert_eq!(
            parse_echo_ip("2605:a141:2335:7656::1"),
            Some("2605:a141:2335:7656::1".to_string())
        );
    }

    #[test]
    fn parse_json_ip() {
        assert_eq!(
            parse_echo_ip(r#"{"ip":"9.9.9.9"}"#),
            Some("9.9.9.9".to_string())
        );
        assert_eq!(
            parse_echo_ip(r#"{"address":"1.1.1.1"}"#),
            Some("1.1.1.1".to_string())
        );
        assert_eq!(
            parse_echo_ip(r#"{"query":"8.8.8.8"}"#),
            Some("8.8.8.8".to_string())
        );
    }

    #[test]
    fn parse_no_ip() {
        assert_eq!(parse_echo_ip("not an ip"), None);
        assert_eq!(parse_echo_ip(""), None);
        assert_eq!(parse_echo_ip(r#"{"ip":"999.999.1.1"}"#), None);
        assert_eq!(parse_echo_ip(r#"{"ip":"1.2.3.4secret"}"#), None);
        assert_eq!(parse_echo_ip("1.2.3.4 extra"), None);
        assert_eq!(parse_echo_ip("ip=1.2.3.4"), Some("1.2.3.4".into()));
    }

    #[test]
    fn reconcile_marks_drift() {
        let prev = HealthState::default();
        let now = "2026-08-06T00:00:00Z";
        let ok = ProbeResult {
            ok: true,
            egress_ip: Some("5.5.5.5".into()),
            latency_ms: 42,
            error: None,
        };
        let st = reconcile_health(&prev, &ok, Some("5.5.5.5"), now);
        assert!(st.healthy);
        assert!(!st.drift);
        assert_eq!(st.fail_count, 0);

        let drift = reconcile_health(&st, &ok, Some("6.6.6.6"), now);
        assert!(drift.drift);
        assert_eq!(drift.fail_count, 0); // drift is a warning, not a failure

        let bad = ProbeResult {
            ok: false,
            egress_ip: None,
            latency_ms: 0,
            error: Some("timeout".into()),
        };
        let fail = reconcile_health(&st, &bad, None, now);
        assert!(!fail.healthy);
        assert_eq!(fail.fail_count, 1);
    }
}
