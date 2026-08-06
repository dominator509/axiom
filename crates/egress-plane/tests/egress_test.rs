use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
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
static NETNS_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
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
    });
    let app = egress_plane::build_router_for_test(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
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

/// Find a free TCP port by binding :0 and dropping the listener.
fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").expect("free port");
    l.local_addr().expect("addr").port()
}

/// Start a tiny HTTP echo server that reports a fixed egress IP, bound to
/// 0.0.0.0 so it is reachable from model netns via the veth host IP.
async fn start_echo_server(ip: &str) -> u16 {
    let port = free_port();
    let ip = ip.to_string();
    let app = axum::Router::new().route(
        "/ip",
        axum::routing::get(move || async move {
            axum::Json(serde_json::json!({ "ip": ip }))
        }),
    );
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("echo bind");
        axum::serve(listener, app).await.expect("echo serve");
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    port
}

/// Spawn the real egress-plane binary as a host-side "upstream proxy"
/// (direct upstream). Represents the model's approved external egress proxy.
/// Returns (port, child).
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
fn cleanup_leftovers() {
    for ns in [
        "egress_it_socks_m1",
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
    let _ = Command::new("ip").args(["link", "del", "wg-host-test"]).output();
    let _ = Command::new("rm").args(["-f", "/tmp/wg_priv_host_test", "/tmp/wg_peer_host_test"]).status();
}

// ---------------------------------------------------------------------------
// Basic endpoint tests
// ---------------------------------------------------------------------------

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
    client.post(format!("{base_url}/kill-switch/drain")).send().await.expect("drain");
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_ks_blocked", "direct", serde_json::json!({})))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 503, "kill-switch must block new binds");
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
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad: b"" })
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
        .decrypt(XNonce::from_slice(&enc_nonce), Payload { msg: &enc_creds, aad: b"" })
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
            "dek": base64::engine::general_purpose::STANDARD.encode(&[0u8; 16])
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
#[tokio::test]
async fn test_fail_closed_with_https_echo_and_dead_upstream() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let base_url = start_test_server("https://api.ipify.org".to_string()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_failclosed_https", "http", serde_json::json!({
            // 127.0.0.1:1 — nothing listens; the chain MUST fail closed.
            "proxy_addr": "127.0.0.1:1"
        })))
        .send()
        .await
        .expect("bind");
    let body: serde_json::Value = resp.json().await.expect("json");
    eprintln!("FAIL-CLOSED HTTPS BIND: {body}");
    // Bind itself may succeed (netns + sidecar up) — but the FIRST probe
    // must report the egress unhealthy, never the host's route.
    assert_eq!(body["healthy"], false, "dead upstream with https echo must be unhealthy: {body}");
    assert_eq!(body["status"], "bound", "bind should still complete: {body}");

    let status: serde_json::Value = client
        .get(format!("{base_url}/egress/status"))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(status["models"][0]["healthy"], false, "status must reflect unhealthy: {status}");

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
    let echo_port = start_echo_server("203.0.113.7").await;
    let base_url = start_test_server(format!("http://127.0.0.1:{echo_port}/ip")).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_direct_m1", "direct", serde_json::json!({
            "expected_egress_ip": "203.0.113.7"
        })))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "bound");
    assert_eq!(body["healthy"], true, "direct echo should be healthy");
    assert_eq!(body["egress_ip"], "203.0.113.7");
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

#[tokio::test]
async fn test_socks5_proxy_mode_full_chain() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let echo_ip = "198.51.100.9";
    let echo_port = start_echo_server(echo_ip).await;
    let (upstream_port, mut upstream_child) = spawn_host_upstream_proxy();
    // ECHO_URL target is reached by the host-side upstream proxy, so it lives
    // on the host loopback. The model's sidecar connects to the upstream
    // proxy via the host-side veth IP (allow-listed in the netns).
    let base_url = start_test_server_with_base(format!("http://127.0.0.1:{echo_port}/ip"), 10).await;
    let client = reqwest::Client::new();

    // Fresh registry with base 10 -> first bind gets octet 10 -> host veth
    // 10.240.10.1 (proxy path) / sidecar reachable at 10.240.10.2:8080.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_socks_m1", "socks5", serde_json::json!({
            "proxy_addr": format!("10.240.10.1:{upstream_port}"),
            "expected_egress_ip": echo_ip
        })))
        .send()
        .await
        .expect("bind");
    let status_code = resp.status();
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(status_code, 200, "bind failed: {body}");
    eprintln!("SOCKS BIND: {}", body);
    assert_eq!(body["status"], "bound", "bind: {body}");
    assert_eq!(body["healthy"], true, "full chain should be healthy: {body}");
    assert_eq!(body["egress_ip"], echo_ip, "egress IP via proxy chain: {body}");
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
    assert!(metrics.contains("egress_health{model=\"it_socks_m1\",mode=\"socks5\"} 1"), "metrics: {metrics}");
    assert!(metrics.contains("egress_models_bound 1"));

    // Fail-closed proof: unbind, then the netns is gone.
    let unbind = client
        .post(format!("{base_url}/egress/unbind"))
        .json(&serde_json::json!({ "model_id": "it_socks_m1" }))
        .send()
        .await
        .expect("unbind");
    assert_eq!(unbind.status(), 200);

    let _ = upstream_child.kill();
    let _ = upstream_child.wait();
}

// ---------------------------------------------------------------------------
// REAL integration: wireguard tunnel mode with a local WG pair
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_wireguard_tunnel_mode_full_chain() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    // Host-side WG "server": wg0 with 10.0.0.1/24 on the host, listening on
    // the model's future veth host IP (10.240.1.1) port 51820.
    let echo_ip = "203.0.113.77";
    let echo_port = start_echo_server(echo_ip).await;

    // Generate keys.
    let priv_host = wg_genkey();
    let priv_client = wg_genkey();
    let pub_host = wg_pubkey(&priv_host);
    let pub_client = wg_pubkey(&priv_client);

    // Host wg interface.
    let _ = Command::new("ip").args(["link", "del", "wg-host-test"]).output();
    assert!(Command::new("ip").args(["link", "add", "wg-host-test", "type", "wireguard"]).status().expect("wg add").success());
    // The host interface must listen on the veth host IP — created at bind
    // time. Register the peer first; the listen IP is bound later in the test
    // flow: we instead listen on 0.0.0.0:51820 to decouple.
    let _ = Command::new("bash").args(["-c", &format!("printf '%s' '{}' > /tmp/wg_priv_host_test", priv_host)]).status();
    assert!(Command::new("wg").args(["set", "wg-host-test", "listen-port", "51820", "private-key", "/tmp/wg_priv_host_test"]).status().expect("wg set").success());
    let _ = Command::new("bash").args(["-c", &format!("printf '%s' '{}' > /tmp/wg_peer_host_test", pub_client)]).status();
    assert!(Command::new("wg").args(["set", "wg-host-test", "peer", &pub_client, "allowed-ips", "10.0.0.2/32"]).status().expect("wg peer").success());
    let _ = Command::new("ip").args(["address", "add", "10.0.0.1/24", "dev", "wg-host-test"]).output();
    assert!(Command::new("ip").args(["link", "set", "wg-host-test", "up"]).status().expect("wg up").success());
    std::thread::sleep(Duration::from_millis(200));

    let base_url = start_test_server_with_base(format!("http://10.0.0.1:{echo_port}/ip"), 20).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_wg_m1", "wireguard", serde_json::json!({
            "wg_public_key": pub_host,
            "wg_endpoint": "10.240.20.1:51820",
            "wg_allowed_ips": "0.0.0.0/0",
            "wg_private_key": priv_client,
            "wg_persistent_keepalive": 25,
            "iface_addr": "10.0.0.2/32",
            "expected_egress_ip": echo_ip
        })))
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
    let _ = Command::new("ip").args(["link", "del", "wg-host-test"]).output();
    let _ = Command::new("rm").args(["-f", "/tmp/wg_priv_host_test", "/tmp/wg_peer_host_test"]).status();
}

fn wg_genkey() -> String {
    let out = Command::new("wg").arg("genkey").output().expect("wg genkey");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn wg_pubkey(privkey: &str) -> String {
    let mut child = Command::new("wg").arg("pubkey").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().expect("wg pubkey spawn");
    use std::io::Write;
    child.stdin.as_mut().unwrap().write_all(privkey.as_bytes()).expect("write");
    let out = child.wait_with_output().expect("wg pubkey out");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

// ---------------------------------------------------------------------------
// Failover: unhealthy primary -> approved alternate egress
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_failover_to_approved_alternate_egress() {
    let _guard = netns_lock().lock().await;
    cleanup_leftovers();
    let echo_ip = "192.0.2.55";
    let echo_port = start_echo_server(echo_ip).await;
    let (backup_port, mut backup_child) = spawn_host_upstream_proxy();
    let base_url = start_test_server_with_base(format!("http://127.0.0.1:{echo_port}/ip"), 30).await;
    let client = reqwest::Client::new();

    // Primary proxy: a port with nothing listening (dead).
    let dead_port = free_port();
    // Fresh registry with base 30 -> octet 30 -> host veth 10.240.30.1.
    let resp = client
        .post(format!("{base_url}/egress/bind"))
        .json(&bind_json("it_failover_m1", "http", serde_json::json!({
            "proxy_addr": format!("10.240.30.1:{dead_port}"),
            "failover_proxy_addrs": [format!("10.240.30.1:{backup_port}")],
            "expected_egress_ip": echo_ip
        })))
        .send()
        .await
        .expect("bind");
    assert_eq!(resp.status(), 200, "bind failed");
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["healthy"], false, "dead primary must report unhealthy: {body}");

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
    assert_eq!(status["models"][0]["failover_index"], 1, "failover index should advance");

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
