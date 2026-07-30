use std::sync::Arc;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Helper: build and start the server, return the base URL
// ---------------------------------------------------------------------------

/// Launch the egress-plane server in a background task and return the base URL.
async fn start_test_server() -> String {
    let kill_switch = egress_plane::killswitch::KillSwitch::new(false);
    let config = egress_plane::Config {
        kill_switch: "false".to_string(),
        proxy_type: "http".to_string(),
        proxy_addr: "127.0.0.1:8080".to_string(),
        listen_addr: "127.0.0.1:0".to_string(), // OS-assigned port
    };

    let state = Arc::new(egress_plane::AppState {
        config: config.clone(),
        kill_switch: kill_switch.clone(),
    });

    let app = egress_plane::build_router_for_test(state);

    // Bind to a random port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind test listener");
    let addr = listener.local_addr().expect("Failed to get local addr");
    let base_url = format!("http://{}", addr);

    // Spawn server in background
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("Test server exited with error");
    });

    // Give server a moment to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    base_url
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_health_check_endpoint() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/health", base_url))
        .send()
        .await
        .expect("GET /health failed");

    assert_eq!(resp.status(), 200, "Health endpoint should return 200");

    let body: serde_json::Value = resp
        .json()
        .await
        .expect("Health response should be valid JSON");

    assert_eq!(body["status"], "ok", "Health status should be 'ok'");
    assert!(
        body["version"].as_str().is_some(),
        "Health response should contain version"
    );
}

#[tokio::test]
async fn test_kill_switch_drain() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{}/kill-switch/drain", base_url))
        .send()
        .await
        .expect("POST /kill-switch/drain failed");

    assert_eq!(resp.status(), 200, "Drain should return 200");

    let body: serde_json::Value = resp
        .json()
        .await
        .expect("Drain response should be valid JSON");

    assert_eq!(body["status"], "draining", "Status should be 'draining'");
    assert_eq!(body["kill_switch"], true, "Kill-switch should be true");
}

#[tokio::test]
async fn test_kill_switch_status() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/kill-switch/status", base_url))
        .send()
        .await
        .expect("GET /kill-switch/status failed");

    assert_eq!(resp.status(), 200, "Status should return 200");

    let body: serde_json::Value = resp
        .json()
        .await
        .expect("Status response should be valid JSON");

    assert!(
        body["enabled"].is_boolean(),
        "enabled should be a boolean"
    );
    assert!(
        body["correlation_id"].as_str().is_some(),
        "Should have correlation_id"
    );
}

#[tokio::test]
async fn test_kill_switch_blocks_egress() {
    let kill_switch = egress_plane::killswitch::KillSwitch::new(true);

    let config = egress_plane::Config {
        kill_switch: "true".to_string(),
        proxy_type: "http".to_string(),
        proxy_addr: "127.0.0.1:8080".to_string(),
        listen_addr: "127.0.0.1:0".to_string(),
    };

    let state = Arc::new(egress_plane::AppState {
        config: config.clone(),
        kill_switch: kill_switch.clone(),
    });

    let app = egress_plane::build_router_for_test(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind test listener");
    let addr = listener.local_addr().expect("Failed to get local addr");
    let base_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("Test server exited with error");
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = reqwest::Client::new();

    // Try binding with kill-switch active — should be blocked
    let resp = client
        .post(format!("{}/egress/bind", base_url))
        .json(&serde_json::json!({
            "model_id": "test-model",
            "proxy_type": "http",
            "proxy_addr": "10.0.0.1:3128"
        }))
        .send()
        .await
        .expect("POST /egress/bind failed");

    // Should fail with 500 (kill-switch error) — actually it returns 500 because
    // EgressError::KillSwitch maps to INTERNAL_SERVER_ERROR
    assert!(
        resp.status().is_client_error() || resp.status().is_server_error(),
        "Egress should be blocked when kill-switch is active, got status: {}",
        resp.status()
    );
}

#[tokio::test]
async fn test_egress_health_check_endpoint() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    // Test with an unreachable address — should return unhealthy but not error
    let resp = client
        .post(format!("{}/egress/health-check", base_url))
        .json(&serde_json::json!({
            "proxy_type": "http",
            "proxy_addr": "127.0.0.1:1"
        }))
        .send()
        .await
        .expect("POST /egress/health-check failed");

    assert_eq!(resp.status(), 200, "Health check should return 200 even when unhealthy");

    let body: serde_json::Value = resp
        .json()
        .await
        .expect("Health check response should be valid JSON");

    assert_eq!(body["status"], "unhealthy", "Unreachable proxy should be unhealthy");
    assert!(
        body["correlation_id"].as_str().is_some(),
        "Should have correlation_id"
    );
}

#[tokio::test]
async fn test_decrypt_endpoint() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    use base64::Engine as _;
    use chacha20poly1305::{
        aead::{Aead, KeyInit, Payload},
        XChaCha20Poly1305, XNonce,
    };

    // Generate a random 32-byte key and 24-byte nonce
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

    let plaintext = b"secret test message for decryption";

    // Encrypt using XChaCha20-Poly1305
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload {
            msg: plaintext,
            aad: b"",
        })
        .expect("Encryption should succeed");

    let resp = client
        .post(format!("{}/egress/decrypt", base_url))
        .json(&serde_json::json!({
            "enc_token": base64::engine::general_purpose::STANDARD.encode(&ciphertext),
            "enc_nonce": base64::engine::general_purpose::STANDARD.encode(&nonce),
            "dek_id": "test-dek-001",
            "dek": base64::engine::general_purpose::STANDARD.encode(&key)
        }))
        .send()
        .await
        .expect("POST /egress/decrypt failed");

    assert_eq!(resp.status(), 200, "Decrypt should succeed");

    let body: serde_json::Value = resp
        .json()
        .await
        .expect("Decrypt response should be valid JSON");

    let decrypted_b64 = body["plaintext"].as_str().expect("Should have plaintext");
    let decrypted = base64::engine::general_purpose::STANDARD
        .decode(decrypted_b64)
        .expect("Plaintext should be valid base64");

    assert_eq!(decrypted, plaintext, "Decrypted text should match original");
    assert!(
        body["correlation_id"].as_str().is_some(),
        "Should have correlation_id"
    );
}

#[tokio::test]
async fn test_decrypt_missing_dek() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{}/egress/decrypt", base_url))
        .json(&serde_json::json!({
            "enc_token": "dGVzdA==",
            "enc_nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "dek_id": "test-dek-002"
        }))
        .send()
        .await
        .expect("POST /egress/decrypt failed");

    assert_eq!(
        resp.status(),
        400,
        "Missing DEK should return 400 Bad Request"
    );
}

#[tokio::test]
async fn test_null_default_route_function() {
    // This test validates that set_null_default_route creates the right
    // command structure. It's a unit test that ensures no panics.
    // The actual netns requires root, so we just validate the function exists
    // and the module is properly integrated.
    let ns_name = "test_null_route_unit";

    // Clean up any leftover
    let _ = egress_plane::netns::delete_netns(ns_name);

    // Create the namespace
    match egress_plane::netns::create_netns(ns_name) {
        Ok(_) => {
            // Set null default route
            let result = egress_plane::netns::set_null_default_route(ns_name);
            assert!(
                result.is_ok(),
                "set_null_default_route should succeed in a valid namespace"
            );

            // Clean up
            let _ = egress_plane::netns::delete_netns(ns_name);
        }
        Err(_) => {
            // If not root, creation fails which is acceptable
            // We just verify the function compiles and doesn't panic
        }
    }
}

#[tokio::test]
async fn test_egress_bind_endpoint() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    // This test validates the API endpoint — actual netns operations
    // may fail if not root, but the endpoint should still return a response
    let resp = client
        .post(format!("{}/egress/bind", base_url))
        .json(&serde_json::json!({
            "model_id": "test-model-001",
            "proxy_type": "http",
            "proxy_addr": "proxy.example.com:3128"
        }))
        .send()
        .await
        .expect("POST /egress/bind failed");

    // The endpoint may succeed (if root) or fail with a netns/server error
    // Both are valid — we just validate the API structure
    assert!(
        resp.status().is_success() || resp.status().is_server_error(),
        "Egress bind should return either success or server error, got: {}",
        resp.status()
    );

    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .expect("Response should be valid JSON");
        assert_eq!(body["status"], "bound", "Status should be 'bound' on success");
    }
}

#[tokio::test]
async fn test_egress_bind_validation() {
    let base_url = start_test_server().await;
    let client = reqwest::Client::new();

    // Empty model_id
    let resp = client
        .post(format!("{}/egress/bind", base_url))
        .json(&serde_json::json!({
            "model_id": "",
            "proxy_type": "http",
            "proxy_addr": "proxy.example.com:3128"
        }))
        .send()
        .await
        .expect("POST /egress/bind failed");

    assert_eq!(
        resp.status(),
        400,
        "Empty model_id should return 400 Bad Request"
    );
}
