use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::io;
use thiserror::Error;
use tracing::{info, warn, instrument};
use uuid::Uuid;

pub mod netns;
pub mod crypto;
pub mod killswitch;

use killswitch::KillSwitch;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum EgressError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("Reqwest error: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Crypto error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("Netns error: {0}")]
    Netns(String),

    #[error("Kill-switch error: {0}")]
    KillSwitch(String),
}

impl IntoResponse for EgressError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            EgressError::Validation(_) | EgressError::Netns(_) => {
                (StatusCode::BAD_REQUEST, self.to_string())
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Config {
    pub kill_switch: String,
    pub proxy_type: String,
    pub proxy_addr: String,
    pub listen_addr: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            kill_switch: std::env::var("KILL_SWITCH").unwrap_or_else(|_| "false".to_string()),
            proxy_type: std::env::var("PROXY_TYPE").unwrap_or_else(|_| "http".to_string()),
            proxy_addr: std::env::var("PROXY_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            listen_addr: std::env::var("LISTEN_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: Config,
    pub kill_switch: KillSwitch,
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct BindRequest {
    pub model_id: String,
    pub proxy_type: String,
    pub proxy_addr: String,
}

#[derive(Debug, Deserialize)]
pub struct HealthCheckRequest {
    pub proxy_type: String,
    pub proxy_addr: String,
}

#[derive(Debug, Deserialize)]
pub struct DecryptRequest {
    pub enc_token: String,   // base64-encoded ciphertext
    pub enc_nonce: String,   // base64-encoded 24-byte nonce
    pub dek_id: String,      // identifier for the DEK (in production would fetch from vault)
    #[serde(default)]
    pub dek: Option<String>, // base64-encoded 32-byte DEK (for testing; production fetches from vault)
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_switch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
pub struct DecryptResponse {
    pub plaintext: String,  // base64-encoded decrypted plaintext
    pub correlation_id: String,
}

#[derive(Debug, Serialize)]
pub struct KillSwitchStatusResponse {
    pub enabled: bool,
    pub correlation_id: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /health — basic health check
#[instrument]
pub async fn health() -> impl IntoResponse {
    info!("Health check requested");
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }),
    )
}

/// POST /egress/bind — configures a netns for a model with fail-closed isolation
#[instrument(skip(state))]
pub async fn egress_bind(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BindRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();

    // Validation
    if body.model_id.is_empty() {
        return Err(EgressError::Validation("model_id must not be empty".to_string()));
    }
    if body.proxy_type.is_empty() {
        return Err(EgressError::Validation("proxy_type must not be empty".to_string()));
    }
    if body.proxy_addr.is_empty() {
        return Err(EgressError::Validation("proxy_addr must not be empty".to_string()));
    }

    // Check kill-switch before allowing egress
    if state.kill_switch.is_enabled() {
        warn!(
            correlation_id = %correlation_id,
            model_id = %body.model_id,
            "Egress blocked by kill-switch"
        );
        return Err(EgressError::KillSwitch(
            "Egress blocked by kill-switch".to_string(),
        ));
    }

    info!(
        correlation_id = %correlation_id,
        model_id = %body.model_id,
        proxy_type = %body.proxy_type,
        proxy_addr = %body.proxy_addr,
        "Binding egress proxy — configuring netns"
    );

    // Create a netns for this model
    let ns_name = format!("egress_{}", body.model_id.replace(|c: char| !c.is_alphanumeric(), "_"));
    netns::create_netns(&ns_name)?;

    // Set fail-closed: null default route (blackhole)
    netns::set_null_default_route(&ns_name)?;

    // Add an allow-rule for the proxy address (extract host)
    let proxy_host = body.proxy_addr.split(':').next().unwrap_or(&body.proxy_addr);
    netns::add_allow_rule(&ns_name, proxy_host)?;

    info!(
        correlation_id = %correlation_id,
        model_id = %body.model_id,
        ns = %ns_name,
        "Egress bind complete"
    );

    Ok((
        StatusCode::OK,
        Json(StatusResponse {
            status: "bound".to_string(),
            model_id: Some(body.model_id),
            kill_switch: Some(state.kill_switch.is_enabled()),
            correlation_id: Some(correlation_id),
        }),
    ))
}

/// POST /egress/health-check — tests proxy connectivity
#[instrument(skip(_state))]
pub async fn egress_health_check(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<HealthCheckRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();

    info!(
        correlation_id = %correlation_id,
        proxy_type = %body.proxy_type,
        proxy_addr = %body.proxy_addr,
        "Performing proxy health check"
    );

    let healthy = netns::health_check_proxy(&body.proxy_type, &body.proxy_addr)
        .await
        .map_err(|e| EgressError::Netns(e))?;

    let status = if healthy { "healthy" } else { "unhealthy" };

    info!(
        correlation_id = %correlation_id,
        proxy_type = %body.proxy_type,
        proxy_addr = %body.proxy_addr,
        status = %status,
        "Proxy health check result"
    );

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": status,
            "proxy_type": body.proxy_type,
            "proxy_addr": body.proxy_addr,
            "correlation_id": correlation_id,
        })),
    ))
}

/// POST /egress/decrypt — decrypts an envelope using XChaCha20-Poly1305
#[instrument(skip(_state))]
pub async fn egress_decrypt(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<DecryptRequest>,
) -> Result<impl IntoResponse, EgressError> {
    let correlation_id = Uuid::new_v4().to_string();

    info!(
        correlation_id = %correlation_id,
        dek_id = %body.dek_id,
        "Decrypting envelope"
    );

    // Decode base64 inputs
    let enc_token = base64_decode(&body.enc_token)
        .map_err(|e| EgressError::Validation(format!("Invalid enc_token: {}", e)))?;
    let enc_nonce = base64_decode(&body.enc_nonce)
        .map_err(|e| EgressError::Validation(format!("Invalid enc_nonce: {}", e)))?;

    // In production, the DEK would be fetched from a vault service by dek_id.
    let mut dek = match &body.dek {
        Some(d) => base64_decode(d)
            .map_err(|e| EgressError::Validation(format!("Invalid dek: {}", e)))?,
        None => {
            return Err(EgressError::Validation(
                "DEK not provided and vault integration not yet connected".to_string(),
            ));
        }
    };

    // Decrypt
    let plaintext = crypto::decrypt_envelope(&enc_token, &enc_nonce, &dek)?;

    // Zero out the DEK from memory after use
    crypto::zeroize(dek.as_mut_slice());

    let plaintext_b64 = base64_encode(&plaintext);

    info!(
        correlation_id = %correlation_id,
        dek_id = %body.dek_id,
        "Decryption successful"
    );

    Ok((
        StatusCode::OK,
        Json(DecryptResponse {
            plaintext: plaintext_b64,
            correlation_id,
        }),
    ))
}

/// POST /kill-switch/drain — drains all egress connections
#[instrument(skip(state))]
pub async fn kill_switch_drain(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();

    warn!(
        correlation_id = %correlation_id,
        "Kill-switch drain requested"
    );

    state.kill_switch.set_enabled(true);
    state.kill_switch.drain_all();

    info!(
        correlation_id = %correlation_id,
        "Kill-switch drain complete — all egress blocked"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "draining",
            "kill_switch": true,
            "correlation_id": correlation_id,
        })),
    )
}

/// GET /kill-switch/status — returns kill-switch state
#[instrument(skip(state))]
pub async fn kill_switch_status(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();
    let enabled = state.kill_switch.is_enabled();

    info!(
        correlation_id = %correlation_id,
        enabled = %enabled,
        "Kill-switch status check"
    );

    (
        StatusCode::OK,
        Json(KillSwitchStatusResponse {
            enabled,
            correlation_id,
        }),
    )
}

/// POST /kill-switch/disable — disables the kill-switch
#[instrument(skip(state))]
pub async fn kill_switch_disable(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let correlation_id = Uuid::new_v4().to_string();

    info!(
        correlation_id = %correlation_id,
        "Kill-switch disable requested"
    );

    state.kill_switch.set_enabled(false);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "disabled",
            "kill_switch": false,
            "correlation_id": correlation_id,
        })),
    )
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("base64 decode error: {}", e))
}

fn base64_encode(input: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(input)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Build the main application router with all routes.
pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/egress/bind", post(egress_bind))
        .route("/egress/health-check", post(egress_health_check))
        .route("/egress/decrypt", post(egress_decrypt))
        .route("/kill-switch/drain", post(kill_switch_drain))
        .route("/kill-switch/status", get(kill_switch_status))
        .route("/kill-switch/disable", post(kill_switch_disable))
        .with_state(state)
}

/// Build a test router (used by integration tests).
pub fn build_router_for_test(state: Arc<AppState>) -> Router {
    build_router(state)
}
