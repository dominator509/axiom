#[cfg(target_os = "linux")]
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(target_os = "linux")]
use tokio::sync::Mutex as AsyncMutex;

// ---------------------------------------------------------------------------
// Host-network serialization lock
// ---------------------------------------------------------------------------
// These integration tests create REAL netns/veth state on the host. Tokio
// runs test functions in parallel, and each test's cleanup_leftovers() wipes
// ALL known egress netns — including ones another test is mid-bind on. That
// race produced "Cannot open network namespace egress_it_failclosed_https"
// (deleted by a sibling test while bind_egress was inside it). Any test that
// creates a netns must hold this lock for its whole body.
#[cfg(target_os = "linux")]
static NETNS_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
#[cfg(target_os = "linux")]
fn netns_lock() -> &'static AsyncMutex<()> {
    NETNS_LOCK.get_or_init(|| AsyncMutex::new(()))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Path to the real egress-plane binary (set by cargo for integration tests).
fn sidecar_bin() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_BIN_EXE_egress-plane"))
}

fn test_config(echo_url: String) -> egress_plane::Config {
    egress_plane::Config {
        kill_switch: "false".to_string(),
        listen_addr: "127.0.0.1:0".to_string(),
        auth_token: None,
        echo_url,
        database_url: None,
        dek: None,
        sidecar_bin: Some(sidecar_bin()),
    }
}

/// Launch the egress-plane server in a background task; returns base URL.
/// `base_octet` picks the veth subnet range (10.240.<base>.0/30) so parallel
/// tests never collide on the host.
async fn start_test_server_with_base(echo_url: String, base_octet: u16) -> String {
    let kill_switch = egress_plane::killswitch::KillSwitch::new(false);
    let config = test_config(echo_url);
    let state = Arc::new(egress_plane::AppState {
        config: config.clone(),
        kill_switch: kill_switch.clone(),
        db: Mutex::new(None),
        registry: Mutex::new(egress_plane::Registry::with_start(base_octet)),
        lifecycle: tokio::sync::Mutex::new(()),
    });
    let app = egress_plane::build_router_for_test(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let base_url = format!("http://{}", addr);
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    base_url
}

async fn start_test_server(echo_url: String) -> String {
    start_test_server_with_base(echo_url, 1).await
}

#[tokio::test]
async fn test_non_loopback_control_plane_requires_token() {
    let kill_switch = egress_plane::killswitch::KillSwitch::new(false);
    let mut config = test_config("https://example.invalid/ip".to_string());
    config.listen_addr = "0.0.0.0:9090".to_string();
    let state = Arc::new(egress_plane::AppState {
        config,
        kill_switch,
        db: Mutex::new(None),
        registry: Mutex::new(egress_plane::Registry::new()),
        lifecycle: tokio::sync::Mutex::new(()),
    });
    let app = egress_plane::build_router_for_test(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });

    let client = reqwest::Client::new();
    let health = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .expect("health");
    assert_eq!(health.status(), 200);

    let status = client
        .get(format!("http://{addr}/egress/status"))
        .send()
        .await
        .expect("status");
    assert_eq!(status.status(), 503);
}

/// Find a free TCP port by binding :0 and dropping the listener.
#[cfg(target_os = "linux")]
fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
    l.local_addr().expect("addr").port()
}

/// Report the actual TCP peer, never a test-supplied expected address.
async fn start_echo_server() -> u16 {
    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .expect("echo bind");
    let port = listener.local_addr().unwrap().port();
    let app =
        axum::Router::new().route(
            "/ip",
            axum::routing::get(
                |axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<
                    std::net::SocketAddr,
                >| async move {
                    axum::Json(serde_json::json!({ "ip": peer.ip().to_string() }))
                },
            ),
        );
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .expect("echo serve");
    });
    port
}

/// Spawn the real egress-plane binary as a host-side "upstream proxy"
/// (direct upstream). Represents the model's approved external egress proxy.
/// Returns (port, child).
#[cfg(target_os = "linux")]
fn spawn_host_upstream_proxy() -> (u16, std::process::Child) {
    let port = free_port();
    let child = Command::new(sidecar_bin())
        .args(["--sidecar", "--listen", &format!("0.0.0.0:{port}")])
        .env("SIDECAR_UPSTREAM", "direct")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn upstream proxy");
    std::thread::sleep(Duration::from_millis(300));
    (port, child)
}

fn bind_json(model_id: &str, mode: &str, extra: serde_json::Value) -> serde_json::Value {
    let mut v = serde_json::json!({
        "model_id": model_id,
        "org_id": "00000000-0000-0000-0000-000000000000",
        "mode": mode,
    });
    if let serde_json::Value::Object(ref mut map) = v {
        if let serde_json::Value::Object(extra_map) = extra {
            for (k, val) in extra_map {
                map.insert(k, val);
            }
        }
    }
    v
}

/// Clean up any leftover netns/veth/wg from failed runs.
#[cfg(target_os = "linux")]
fn cleanup_leftovers() {
    assert_eq!(
        std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref(),
        Ok("1"),
        "run privileged tests through scripts/rehearse-egress.mjs, never directly on a shared host"
    );
    for ns in [
        "egress_it_socks_m1",
        "egress_it_socks_m2",
        "egress_it_wg_m1",
        "egress_it_direct_m1",
        "egress_it_failover_m1",
        "egress_it_ks_blocked",
        "egress_it_failclosed_https",
    ] {
        let _ = Command::new("ip").args(["netns", "del", ns]).output();
    }
    // Delete every host-side egress veth (orphaned by panicked runs).
    if let Ok(out) = Command::new("ip").args(["-o", "link", "show"]).output() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
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
    let _ = Command::new("ip")
        .args(["link", "del", "wg-host-test"])
        .output();
    let _ = Command::new("rm")
        .args(["-f", "/tmp/wg_priv_host_test", "/tmp/wg_peer_host_test"])
        .status();
}

#[cfg(target_os = "linux")]
fn ns_curl(ns: &str, url: &str) -> std::process::Output {
    Command::new("ip")
        .args([
            "netns",
            "exec",
            ns,
            "setpriv",
            "--bounding-set=-all",
            "--inh-caps=-all",
            "--ambient-caps=-all",
            "--no-new-privs",
            "curl",
            "--noproxy",
            "*",
            "--silent",
            "--fail",
            "--max-time",
            "1",
            url,
        ])
        .output()
        .expect("namespace curl")
}

#[cfg(target_os = "linux")]
fn assert_sidecar_unprivileged(ns: &str) {
    let pids = Command::new("ip")
        .args(["netns", "pids", ns])
        .output()
        .unwrap();
    let pids = String::from_utf8(pids.stdout).unwrap();
    assert!(
        !pids.trim().is_empty(),
        "sidecar must exist for privilege assertion"
    );
    for pid in pids.split_whitespace() {
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap();
        for field in ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"] {
            assert!(
                status
                    .lines()
                    .any(|line| line == format!("{field}:\t0000000000000000")),
                "nonzero {field}"
            );
        }
        assert!(status.lines().any(|line| line == "NoNewPrivs:\t1"));
        let env = std::fs::read(format!("/proc/{pid}/environ")).unwrap();
        assert!(!env.windows(13).any(|x| x == b"DATABASE_URL="));
        assert!(!env.windows(11).any(|x| x == b"EGRESS_DEK="));
    }
}

// ---------------------------------------------------------------------------
// Basic endpoint tests
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires isolated Linux provisioning capabilities"]
async fn test_net_admin_alone_cannot_provision_namespaces() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let output = Command::new("setpriv")
        .args([
            "--bounding-set=-sys_admin",
            "sh",
            "-c",
            "awk '/CapEff:/ {print $2}' /proc/self/status; exec ip netns add egress_it_limited",
        ])
        .output()
        .unwrap();
    let caps = u64::from_str_radix(String::from_utf8_lossy(&output.stdout).trim(), 16).unwrap();
    assert_ne!(caps & (1 << 12), 0, "NET_ADMIN positive control");
    assert_eq!(caps & (1 << 21), 0, "SYS_ADMIN was not removed");
    if output.status.success() {
        let _ = Command::new("ip")
            .args(["netns", "del", "egress_it_limited"])
            .output();
    }
    assert!(
        !output.status.success(),
        "update the production capability assessment if the kernel contract changes"
    );
}

#[tokio::test]
async fn test_health_check_endpoint() {
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let resp = reqwest::Client::new()
        .get(format!("{base_url}/health"))
        .send()
        .await
        .expect("GET /health");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "ok");
    assert!(body["version"].as_str().is_some());
}

#[tokio::test]
async fn test_kill_switch_drain_and_status() {
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base_url}/kill-switch/drain"))
        .send()
        .await
        .expect("drain");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "draining");
    assert_eq!(body["kill_switch"], true);

    let status: serde_json::Value = client
        .get(format!("{base_url}/kill-switch/status"))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(status["enabled"], true);

    let disable: serde_json::Value = client
        .post(format!("{base_url}/kill-switch/disable"))
        .send()
        .await
        .expect("disable")
        .json()
        .await
        .expect("json");
    assert_eq!(disable["kill_switch"], false);
}

#[tokio::test]
async fn test_kill_switch_blocks_bind() {
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();
    client
        .post(format!("{base_url}/kill-switch/drain"))
        .send()
        .await
        .expect("drain");
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_ks_blocked", "direct", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 503, "kill-switch must block new binds");
}

#[tokio::test]
async fn test_drain_during_probe_cannot_resurrect_binding() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let slow = Arc::new(AtomicBool::new(false));
    let reached = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (s, r, done) = (slow.clone(), reached.clone(), release.clone());
    let echo = axum::Router::new().route(
        "/ip",
        axum::routing::get(move || {
            let (s, r, done) = (s.clone(), r.clone(), done.clone());
            async move {
                if s.load(Ordering::SeqCst) {
                    r.notify_one();
                    done.notified().await;
                }
                axum::Json(serde_json::json!({"ip":"127.0.0.1"}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, echo).await.unwrap() });
    let base = start_test_server(format!("http://{addr}/ip")).await;
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .post(format!("{base}/egress/bind"))
            .json(&bind_json("probe_race", "direct", serde_json::json!({})))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    slow.store(true, Ordering::SeqCst);
    let request = client
        .post(format!("{base}/egress/health-check/model"))
        .json(&serde_json::json!({"model_id":"probe_race"}));
    let probe = tokio::spawn(async move { request.send().await.unwrap() });
    tokio::time::timeout(Duration::from_secs(2), reached.notified())
        .await
        .unwrap();
    assert_eq!(
        client
            .post(format!("{base}/kill-switch/drain"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    release.notify_one();
    assert_eq!(probe.await.unwrap().status(), 503);
    let status: serde_json::Value = client
        .get(format!("{base}/egress/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["count"], 0);
    server.abort();
}

#[tokio::test]
async fn test_continuous_monitor_detects_failure_without_operator_probe() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let ready = Arc::new(AtomicBool::new(true));
    let toggle = ready.clone();
    let echo = axum::Router::new().route(
        "/ip",
        axum::routing::get(move || {
            let toggle = toggle.clone();
            async move {
                (
                    if toggle.load(Ordering::SeqCst) {
                        axum::http::StatusCode::OK
                    } else {
                        axum::http::StatusCode::SERVICE_UNAVAILABLE
                    },
                    "127.0.0.1",
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let echo_addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, echo).await.unwrap() });
    let state = Arc::new(egress_plane::AppState {
        config: test_config(format!("http://{echo_addr}/ip")),
        kill_switch: egress_plane::killswitch::KillSwitch::new(false),
        db: Mutex::new(None),
        registry: Mutex::new(egress_plane::Registry::new()),
        lifecycle: tokio::sync::Mutex::new(()),
    });
    let request: egress_plane::BindRequest =
        serde_json::from_value(bind_json("monitor", "direct", serde_json::json!({}))).unwrap();
    assert!(
        egress_plane::egress_bind(axum::extract::State(state.clone()), axum::Json(request))
            .await
            .is_ok()
    );
    ready.store(false, Ordering::SeqCst);
    egress_plane::spawn_health_monitor(&state, Duration::from_millis(20));
    let mut detected = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let registry = state.registry.lock().unwrap();
        if registry.bounds["monitor"].health.fail_count > 0 {
            assert!(!registry.bounds["monitor"].health.healthy);
            assert_eq!(registry.binds_total, 1, "health polling is not a new bind");
            detected = true;
            break;
        }
    }
    assert!(
        detected,
        "background monitor did not observe the real HTTP failure"
    );
    server.abort();
}

#[tokio::test]
async fn test_decrypt_endpoint_roundtrip() {
    use base64::Engine as _;
    use chacha20poly1305::{
        aead::{Aead, KeyInit, Payload},
        XChaCha20Poly1305, XNonce,
    };
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();
    let key = {
        let mut k = vec![0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut k);
        k
    };
    let nonce = {
        let mut n = vec![0u8; 24];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut n);
        n
    };
    let plaintext = b"egress envelope secret";
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: b"",
            },
        )
        .expect("encrypt");

    let resp = client
        .post(format!("{base_url}/egress/decrypt"))
        .json(&serde_json::json!({
            "enc_token": base64::engine::general_purpose::STANDARD.encode(&ciphertext),
            "enc_nonce": base64::engine::general_purpose::STANDARD.encode(&nonce),
            "dek_id": "test-dek",
            "dek": base64::engine::general_purpose::STANDARD.encode(&key)
        }))
        .send()
        .await
        .expect("decrypt");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    let decrypted = base64::engine::general_purpose::STANDARD
        .decode(body["plaintext"].as_str().unwrap())
        .unwrap();
    assert_eq!(decrypted, plaintext);
}

#[tokio::test]
async fn test_encrypt_endpoint_roundtrip() {
    use base64::Engine as _;
    use chacha20poly1305::{
        aead::{Aead, KeyInit, Payload},
        XChaCha20Poly1305, XNonce,
    };
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();
    let key = {
        let mut k = vec![0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut k);
        k
    };
    let plaintext = br#"{"proxy_username":"u","proxy_password":"p","wg_private_key":"k"}"#;

    let resp = client
        .post(format!("{base_url}/egress/encrypt"))
        .json(&serde_json::json!({
            "plaintext": base64::engine::general_purpose::STANDARD.encode(plaintext),
            "dek_id": "test-dek",
            "dek": base64::engine::general_purpose::STANDARD.encode(&key)
        }))
        .send()
        .await
        .expect("encrypt");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["dek_id"], "test-dek");
    let enc_creds = base64::engine::general_purpose::STANDARD
        .decode(body["enc_creds"].as_str().unwrap())
        .unwrap();
    let enc_nonce = base64::engine::general_purpose::STANDARD
        .decode(body["enc_nonce"].as_str().unwrap())
        .unwrap();
    assert_eq!(enc_nonce.len(), 24, "XChaCha20 nonce must be 24 bytes");

    // Decrypt the envelope externally and confirm the plaintext round-trips.
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    let decrypted = cipher
        .decrypt(
            XNonce::from_slice(&enc_nonce),
            Payload {
                msg: &enc_creds,
                aad: b"",
            },
        )
        .expect("decrypt");
    assert_eq!(decrypted, plaintext);
}

#[tokio::test]
async fn test_encrypt_endpoint_rejects_bad_dek() {
    use base64::Engine as _;
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base_url}/egress/encrypt"))
        .json(&serde_json::json!({
            "plaintext": base64::engine::general_purpose::STANDARD.encode(b"x"),
            "dek_id": "test-dek",
            "dek": base64::engine::general_purpose::STANDARD.encode([0u8; 16])
        }))
        .send()
        .await
        .expect("encrypt");
    assert_eq!(resp.status(), 400, "16-byte DEK must be rejected");
}

// Regression: LBI-02 fail-closed with an HTTPS echo URL. Before the
// Proxy::http -> Proxy::all fix, the health probe bypassed the sidecar for
// https:// echo targets and measured the HOST route — reporting healthy:true
// through a DEAD upstream. A dead upstream must report healthy:false even
// when the echo endpoint is HTTPS (the default api.ipify.org).
#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires root and Linux network namespace privileges"]
async fn test_fail_closed_with_https_echo_and_dead_upstream() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    // A reachable host-side TLS destination is a leak detector even if the
    // attempted TLS handshake would not authenticate. First prove it accepts.
    let forbidden = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = forbidden.local_addr().unwrap();
    let control = tokio::net::TcpStream::connect(target).await.unwrap();
    let _ = forbidden.accept().await.unwrap();
    drop(control);
    let base_url = start_test_server(format!("https://{target}/ip")).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_failclosed_https",
            "http",
            serde_json::json!({
                // 127.0.0.1:1 — nothing listens; the chain MUST fail closed.
                "proxy_addr": "127.0.0.1:1"
            }),
        ))
        .send()
        .await
        .expect("bind");
    let body: serde_json::Value = resp.json().await.expect("json");
    eprintln!("FAIL-CLOSED HTTPS BIND: {body}");
    // Bind itself may succeed (netns + sidecar up) — but the FIRST probe
    // must report the egress unhealthy, never the host's route.
    assert_eq!(
        body["healthy"], false,
        "dead upstream with https echo must be unhealthy: {body}"
    );
    assert_eq!(
        body["status"], "bound",
        "bind should still complete: {body}"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(300), forbidden.accept())
            .await
            .is_err(),
        "HTTPS health probe bypassed the dead proxy and contacted the host target"
    );

    let status: serde_json::Value = client
        .get(format!("{base_url}/egress/status"))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(
        status["models"][0]["healthy"], false,
        "status must reflect unhealthy: {status}"
    );

    let unbind = client
        .post(format!("{base_url}/egress/unbind"))
        .json(&serde_json::json!({ "model_id": "it_failclosed_https" }))
        .send()
        .await
        .expect("unbind");
    assert_eq!(unbind.status(), 200);
}

// ---------------------------------------------------------------------------
// REAL integration: direct mode (no isolation, explicit opt-in)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_direct_mode_bind_and_health() {
    let echo_port = start_echo_server().await;
    let base_url = start_test_server(format!("http://127.0.0.1:{echo_port}/ip")).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_direct_m1",
            "direct",
            serde_json::json!({
                "expected_egress_ip": "127.0.0.1"
            }),
        ))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "bound");
    assert_eq!(body["healthy"], true, "direct echo should be healthy");
    assert_eq!(body["egress_ip"], "127.0.0.1");
    assert_eq!(body["drift"], false);

    // unbind
    let unbind = client
        .post(format!("{base_url}/egress/unbind"))
        .json(&serde_json::json!({ "model_id": "it_direct_m1" }))
        .send()
        .await
        .expect("unbind");
    assert_eq!(unbind.status(), 200);
}

// ---------------------------------------------------------------------------
// REAL integration: socks5 proxy mode through the full sidecar chain
// ---------------------------------------------------------------------------
// Topology (all local, all real):
//   API client -> host veth IP:8080 (sidecar IN model netns)
//     -> netns allow-listed upstream proxy (host-side egress-plane --sidecar)
//       -> CONNECT target (echo server on host veth IP)
// The netns has a blackhole default route; the ONLY reachable host is the
// approved upstream proxy — this is the LBI-02 fail-closed proof.

#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires root and Linux network namespace privileges"]
async fn test_socks5_proxy_mode_full_chain() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let echo_ip = "127.0.0.1";
    let echo_port = start_echo_server().await;
    let (upstream_port, mut upstream_child) = spawn_host_upstream_proxy();
    // ECHO_URL target is reached by the host-side upstream proxy, so it lives
    // on the host loopback. The model's sidecar connects to the upstream
    // proxy via the host-side veth IP (allow-listed in the netns).
    let base_url =
        start_test_server_with_base(format!("http://127.0.0.1:{echo_port}/ip"), 10).await;
    let client = reqwest::Client::new();

    // Fresh registry with base 10 -> first bind gets octet 10 -> host veth
    // 10.240.10.1 (proxy path) / sidecar reachable at 10.240.10.2:8080.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_socks_m1",
            "socks5",
            serde_json::json!({
                "proxy_addr": format!("10.240.10.1:{upstream_port}"),
                "expected_egress_ip": echo_ip
            }),
        ))
        .send()
        .await
        .expect("bind");
    let status_code = resp.status();
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(status_code, 200, "bind failed: {body}");
    eprintln!("SOCKS BIND: {}", body);
    assert_eq!(body["status"], "bound", "bind: {body}");
    assert_eq!(
        body["healthy"], true,
        "full chain should be healthy: {body}"
    );
    assert_eq!(
        body["egress_ip"], echo_ip,
        "egress IP via proxy chain: {body}"
    );
    assert_eq!(body["drift"], false);

    // Status endpoint reflects the bound model.
    let status: serde_json::Value = client
        .get(format!("{base_url}/egress/status"))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(status["count"], 1);
    assert_eq!(status["models"][0]["mode"], "socks5");
    assert_eq!(status["models"][0]["healthy"], true);

    // Metrics expose health + latency.
    let metrics = client
        .get(format!("{base_url}/metrics"))
        .send()
        .await
        .expect("metrics")
        .text()
        .await
        .expect("text");
    assert!(
        metrics.contains("egress_health{model=\"it_socks_m1\",mode=\"socks5\"} 1"),
        "metrics: {metrics}"
    );
    assert!(metrics.contains("egress_models_bound 1"));

    assert_sidecar_unprivileged("egress_it_socks_m1");
    // Separate local forwarding overhead from provider latency (L4.2).
    let mut overhead = Vec::new();
    let echo = format!("http://127.0.0.1:{echo_port}/ip");
    for _ in 0..11 {
        let began = std::time::Instant::now();
        let direct = egress_plane::health::probe_echo(&echo, None, Duration::from_secs(2)).await;
        let baseline = began.elapsed();
        let began = std::time::Instant::now();
        let proxied = egress_plane::health::probe_echo(
            &echo,
            Some(("10.240.10.2", 8080)),
            Duration::from_secs(2),
        )
        .await;
        assert!(
            direct.ok && proxied.ok,
            "latency samples require successful paths"
        );
        overhead.push(began.elapsed().saturating_sub(baseline).as_micros());
    }
    overhead.sort_unstable();
    eprintln!("EGRESS_PROXY_ADDED_LATENCY_P50_US={}", overhead[5]);
    assert!(
        overhead[5] < 5000,
        "L4.2 forwarding overhead exceeded 5ms: {}us",
        overhead[5]
    );
    // A live listener is reachable in the parent, but the very same approved
    // proxy IP on a different port must not be reachable from the model.
    let canary = format!("http://10.240.10.1:{echo_port}/ip");
    assert!(client
        .get(&canary)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert!(
        !ns_curl("egress_it_socks_m1", &canary).status.success(),
        "host port leak"
    );
    // Positive UDP control followed by the identical target from the netns.
    let udp = tokio::net::UdpSocket::bind("0.0.0.0:0").await.unwrap();
    let udp_port = udp.local_addr().unwrap().port();
    let sender = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
    sender
        .send_to(b"control", format!("127.0.0.1:{udp_port}"))
        .await
        .unwrap();
    let mut packet = [0u8; 64];
    udp.recv_from(&mut packet).await.unwrap();
    let sent = Command::new("ip")
        .args([
            "netns",
            "exec",
            "egress_it_socks_m1",
            "bash",
            "-c",
            &format!("printf dns-leak > /dev/udp/10.240.10.1/{udp_port}"),
        ])
        .output()
        .unwrap();
    let _ = sent; // UDP send success never establishes packet delivery.
    assert!(
        tokio::time::timeout(Duration::from_millis(400), udp.recv_from(&mut packet))
            .await
            .is_err(),
        "UDP/DNS bypass"
    );

    let b = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_socks_m2",
            "socks5",
            serde_json::json!({"proxy_addr":format!("10.240.11.1:{upstream_port}")}),
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(
        b.json::<serde_json::Value>().await.unwrap()["healthy"],
        true
    );
    let cross_model = Command::new("ip")
        .args([
            "netns",
            "exec",
            "egress_it_socks_m1",
            "setpriv",
            "--bounding-set=-all",
            "--inh-caps=-all",
            "--ambient-caps=-all",
            "--no-new-privs",
            "curl",
            "--silent",
            "--fail",
            "--max-time",
            "1",
            "--noproxy",
            "",
            "--proxy",
            "http://10.240.11.2:8080",
            &echo,
        ])
        .output()
        .unwrap();
    assert!(
        !cross_model.status.success(),
        "cross-model proxy returned the real echo"
    );
    // Real connected IPv6 canary with static neighbors: a failed neighbor
    // lookup must not be mistaken for firewall enforcement.
    let v6 = tokio::net::TcpListener::bind("[::]:0").await.unwrap();
    let parent: serde_json::Value = serde_json::from_slice(
        &Command::new("ip")
            .args(["-j", "addr", "show", "to", "10.240.10.1/32"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let child: serde_json::Value = serde_json::from_str(
        &egress_plane::netns::execute_in_netns(
            "egress_it_socks_m1",
            &["ip", "-j", "addr", "show", "to", "10.240.10.2/32"],
        )
        .unwrap(),
    )
    .unwrap();
    let parent_if = parent[0]["ifname"].as_str().unwrap();
    let child_if = child[0]["ifname"].as_str().unwrap();
    // Address-filtered `ip addr` output need not include the link-layer
    // address. Read it from the link object, not the address projection.
    let parent_link: serde_json::Value = serde_json::from_slice(
        &Command::new("ip")
            .args(["-j", "link", "show", "dev", parent_if])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let child_link: serde_json::Value = serde_json::from_str(
        &egress_plane::netns::execute_in_netns(
            "egress_it_socks_m1",
            &["ip", "-j", "link", "show", "dev", child_if],
        )
        .unwrap(),
    )
    .unwrap();
    assert!(Command::new("ip")
        .args(["-6", "addr", "add", "fd77::1/64", "dev", parent_if, "nodad"])
        .status()
        .unwrap()
        .success());
    egress_plane::netns::execute_in_netns(
        "egress_it_socks_m1",
        &[
            "ip",
            "-6",
            "addr",
            "add",
            "fd77::2/64",
            "dev",
            child_if,
            "nodad",
        ],
    )
    .unwrap();
    egress_plane::netns::execute_in_netns(
        "egress_it_socks_m1",
        &[
            "ip",
            "-6",
            "neigh",
            "replace",
            "fd77::1",
            "lladdr",
            parent_link[0]["address"].as_str().unwrap(),
            "dev",
            child_if,
            "nud",
            "permanent",
        ],
    )
    .unwrap();
    assert!(Command::new("ip")
        .args([
            "-6",
            "neigh",
            "replace",
            "fd77::2",
            "lladdr",
            child_link[0]["address"].as_str().unwrap(),
            "dev",
            parent_if,
            "nud",
            "permanent"
        ])
        .status()
        .unwrap()
        .success());
    assert!(tokio::net::TcpStream::connect(format!(
        "[fd77::1]:{}",
        v6.local_addr().unwrap().port()
    ))
    .await
    .is_ok());
    let _ = v6.accept().await.unwrap(); // consume the positive-control connection
    let rules =
        egress_plane::netns::execute_in_netns("egress_it_socks_m1", &["ip6tables", "-S", "OUTPUT"])
            .unwrap();
    assert!(rules.contains("-P OUTPUT DROP"));
    assert!(!ns_curl(
        "egress_it_socks_m1",
        &format!("http://[fd77::1]:{}/", v6.local_addr().unwrap().port())
    )
    .status
    .success());
    assert!(
        tokio::time::timeout(Duration::from_millis(300), v6.accept())
            .await
            .is_err(),
        "IPv6 canary accepted a forbidden connection"
    );

    // Drain kills both live data planes, not just their health flags.
    assert_eq!(
        client
            .post(format!("{base_url}/kill-switch/drain"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert!(tokio::net::TcpStream::connect("10.240.10.2:8080")
        .await
        .is_err());
    let drained: serde_json::Value = client
        .get(format!("{base_url}/egress/status"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(drained["count"], 0);

    let _ = upstream_child.kill();
    let _ = upstream_child.wait();
}

// ---------------------------------------------------------------------------
// REAL integration: wireguard tunnel mode with a local WG pair
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires root, Linux network namespaces, and WireGuard tools"]
async fn test_wireguard_tunnel_mode_full_chain() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    // Host-side WG "server": wg0 with 10.0.0.1/24 on the host, listening on
    // the model's future veth host IP (10.240.1.1) port 51820.
    let echo_ip = "10.0.0.2";
    let echo_port = start_echo_server().await;

    // Generate keys.
    let priv_host = wg_genkey();
    let priv_client = wg_genkey();
    let pub_host = wg_pubkey(&priv_host);
    let pub_client = wg_pubkey(&priv_client);
    let preshared_key = wg_genpsk();

    // Host wg interface.
    let _ = Command::new("ip")
        .args(["link", "del", "wg-host-test"])
        .output();
    assert!(Command::new("ip")
        .args(["link", "add", "wg-host-test", "type", "wireguard"])
        .status()
        .expect("wg add")
        .success());
    // The host interface must listen on the veth host IP — created at bind
    // time. Register the peer first; the listen IP is bound later in the test
    // flow: we instead listen on 0.0.0.0:51820 to decouple.
    let _ = Command::new("bash")
        .args([
            "-c",
            &format!("printf '%s' '{}' > /tmp/wg_priv_host_test", priv_host),
        ])
        .status();
    assert!(Command::new("wg")
        .args([
            "set",
            "wg-host-test",
            "listen-port",
            "51820",
            "private-key",
            "/tmp/wg_priv_host_test"
        ])
        .status()
        .expect("wg set")
        .success());
    let _ = Command::new("bash")
        .args([
            "-c",
            &format!(
                "printf '%s' '{}' > /tmp/wg_peer_host_test && printf '%s' '{}' > /tmp/wg_psk_host_test",
                pub_client, preshared_key
            ),
        ])
        .status();
    assert!(Command::new("wg")
        .args([
            "set",
            "wg-host-test",
            "peer",
            &pub_client,
            "preshared-key",
            "/tmp/wg_psk_host_test",
            "allowed-ips",
            "10.0.0.2/32"
        ])
        .status()
        .expect("wg peer")
        .success());
    let _ = Command::new("ip")
        .args(["address", "add", "10.0.0.1/24", "dev", "wg-host-test"])
        .output();
    assert!(Command::new("ip")
        .args(["link", "set", "wg-host-test", "up"])
        .status()
        .expect("wg up")
        .success());
    std::thread::sleep(Duration::from_millis(200));

    let base_url = start_test_server_with_base(format!("http://10.0.0.1:{echo_port}/ip"), 20).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_wg_m1",
            "wireguard",
            serde_json::json!({
                "wg_public_key": pub_host,
                "wg_endpoint": "10.240.20.1:51820",
                "wg_allowed_ips": "0.0.0.0/0",
                "wg_private_key": priv_client,
                "wg_preshared_key": preshared_key,
                "wg_persistent_keepalive": 25,
                "iface_addr": "10.0.0.2/32",
                "expected_egress_ip": echo_ip
            }),
        ))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 200, "wg bind failed");
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "bound", "wg bind: {body}");

    // Give the tunnel a moment to handshake (first handshake can take ~1-3s).
    let mut healthy = false;
    for _ in 0..10 {
        let hc: serde_json::Value = client
            .post(format!("{base_url}/egress/health-check/model"))
            .json(&serde_json::json!({ "model_id": "it_wg_m1" }))
            .send()
            .await
            .expect("health")
            .json()
            .await
            .expect("json");
        if hc["status"] == "healthy" {
            healthy = true;
            assert_eq!(hc["egress_ip"], echo_ip, "tunnel egress IP: {hc}");
            break;
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
    assert!(healthy, "wireguard tunnel never became healthy");

    assert_sidecar_unprivileged("egress_it_wg_m1");
    assert!(egress_plane::tunnel::tunnel_has_handshake(
        "egress_it_wg_m1"
    ));
    assert!(Command::new("ip")
        .args(["link", "set", "wg-host-test", "down"])
        .status()
        .unwrap()
        .success());
    let failed: serde_json::Value = client
        .post(format!("{base_url}/egress/health-check/model"))
        .json(&serde_json::json!({"model_id":"it_wg_m1"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        failed["status"], "unhealthy",
        "tunnel loss must never select host egress"
    );
    assert!(!ns_curl(
        "egress_it_wg_m1",
        &format!("http://10.240.20.1:{echo_port}/ip")
    )
    .status
    .success());

    // Drift policy: expect a different IP -> drift flag set (health still ok).
    // The bound config's expected IP is still echo_ip, so no drift here;
    // drift is covered by the unit tests. Assert health again for stability.

    // Cleanup: unbind (tears down tunnel + netns) and remove host wg.
    let unbind = client
        .post(format!("{base_url}/egress/unbind"))
        .json(&serde_json::json!({ "model_id": "it_wg_m1" }))
        .send()
        .await
        .expect("unbind");
    assert_eq!(unbind.status(), 200);
    let _ = Command::new("ip")
        .args(["link", "del", "wg-host-test"])
        .output();
    let _ = Command::new("rm")
        .args([
            "-f",
            "/tmp/wg_priv_host_test",
            "/tmp/wg_peer_host_test",
            "/tmp/wg_psk_host_test",
        ])
        .status();
}

#[cfg(target_os = "linux")]
fn wg_genkey() -> String {
    let out = Command::new("wg")
        .arg("genkey")
        .output()
        .expect("wg genkey");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[cfg(target_os = "linux")]
fn wg_genpsk() -> String {
    let out = Command::new("wg")
        .arg("genpsk")
        .output()
        .expect("wg genpsk");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[cfg(target_os = "linux")]
fn wg_pubkey(privkey: &str) -> String {
    let mut child = Command::new("wg")
        .arg("pubkey")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("wg pubkey spawn");
    use std::io::Write;
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(privkey.as_bytes())
        .expect("write");
    let out = child.wait_with_output().expect("wg pubkey out");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

// ---------------------------------------------------------------------------
// Failover: unhealthy primary -> approved alternate egress
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "requires root and Linux network namespace privileges"]
async fn test_failover_to_approved_alternate_egress() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let echo_ip = "127.0.0.1";
    let echo_port = start_echo_server().await;
    let (backup_port, mut backup_child) = spawn_host_upstream_proxy();
    let base_url =
        start_test_server_with_base(format!("http://127.0.0.1:{echo_port}/ip"), 30).await;
    let client = reqwest::Client::new();

    // Primary proxy: a port with nothing listening (dead).
    let dead_port = free_port();
    // Fresh registry with base 30 -> octet 30 -> host veth 10.240.30.1.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json(
            "it_failover_m1",
            "http",
            serde_json::json!({
                "proxy_addr": format!("10.240.30.1:{dead_port}"),
                "failover_proxy_addrs": [format!("10.240.30.1:{backup_port}")],
                "expected_egress_ip": echo_ip
            }),
        ))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 200, "bind failed");
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(
        body["healthy"], false,
        "dead primary must report unhealthy: {body}"
    );

    // Trigger health-check: should fail over to the backup and become healthy.
    let hc: serde_json::Value = client
        .post(format!("{base_url}/egress/health-check/model"))
        .json(&serde_json::json!({ "model_id": "it_failover_m1" }))
        .send()
        .await
        .expect("health")
        .json()
        .await
        .expect("json");
    assert_eq!(hc["status"], "healthy", "failover should recover: {hc}");
    assert_eq!(hc["egress_ip"], echo_ip);

    let status: serde_json::Value = client
        .get(format!("{base_url}/egress/status"))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(
        status["models"][0]["failover_index"], 1,
        "failover index should advance"
    );

    // Cleanup.
    let _ = client
        .post(format!("{base_url}/egress/unbind"))
        .json(&serde_json::json!({ "model_id": "it_failover_m1" }))
        .send()
        .await;
    let _ = backup_child.kill();
    let _ = backup_child.wait();
}

// ---------------------------------------------------------------------------
// Bind validation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_bind_validation() {
    let base_url = start_test_server("http://127.0.0.1:9/ip".to_string()).await;
    let client = reqwest::Client::new();

    // Empty model id.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("", "direct", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 400);

    // Invalid mode.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_bad_mode", "bogus", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 400);

    // Proxy mode without proxy_addr.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_no_proxy", "socks5", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 400);

    // Tunnel mode without wg_private_key.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_no_key", "wireguard", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 400);
}
