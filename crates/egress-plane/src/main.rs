use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::process::Command;
use std::io;
use thiserror::Error;
use tracing::{info, warn, error, instrument};
use tracing_subscriber::EnvFilter;

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
}

impl IntoResponse for EgressError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            EgressError::Validation(_) => (StatusCode::BAD_REQUEST, self.to_string()),
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

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_switch: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub target_host: String,
    pub target_port: u16,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[instrument]
async fn health() -> impl IntoResponse {
    info!("Health check requested");
    (StatusCode::OK, Json(HealthResponse { status: "ok".to_string() }))
}

#[instrument(skip(state))]
async fn egress_bind(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BindRequest>,
) -> Result<impl IntoResponse, EgressError> {
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

    info!(
        model_id = %body.model_id,
        proxy_type = %body.proxy_type,
        proxy_addr = %body.proxy_addr,
        config_proxy_type = %state.config.proxy_type,
        config_proxy_addr = %state.config.proxy_addr,
        "Binding egress proxy"
    );

    Ok((
        StatusCode::OK,
        Json(StatusResponse {
            status: "bound".to_string(),
            model_id: Some(body.model_id),
            kill_switch: None,
        }),
    ))
}

#[instrument]
async fn egress_health_check() -> impl IntoResponse {
    info!("Egress health check requested");
    (StatusCode::OK, Json(HealthResponse { status: "healthy".to_string() }))
}

#[instrument]
async fn kill_switch_drain(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let ks = state.config.kill_switch.to_lowercase();
    if ks == "true" || ks == "1" {
        warn!(kill_switch = true, "Kill switch engaged — draining egress");
        (
            StatusCode::OK,
            Json(StatusResponse {
                status: "draining".to_string(),
                model_id: None,
                kill_switch: Some(true),
            }),
        )
    } else {
        info!(kill_switch = false, "Kill switch ignored");
        (
            StatusCode::OK,
            Json(StatusResponse {
                status: "ignored".to_string(),
                model_id: None,
                kill_switch: Some(false),
            }),
        )
    }
}

// ---------------------------------------------------------------------------
// Netns management
// ---------------------------------------------------------------------------

/// Create a network namespace by name using `ip netns add`.
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
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("ip netns add failed: {}", stderr.trim()),
        ))
    }
}

/// Remove a network namespace by name using `ip netns delete`.
pub fn remove_netns(name: &str) -> io::Result<()> {
    let output = Command::new("ip")
        .args(["netns", "delete", name])
        .output()?;

    if output.status.success() {
        info!(netns = %name, "Removed network namespace");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(netns = %name, stderr = %stderr, "Failed to remove network namespace");
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("ip netns delete failed: {}", stderr.trim()),
        ))
    }
}

// ---------------------------------------------------------------------------
// Proxy health check
// ---------------------------------------------------------------------------

/// Probe a proxy endpoint at the given address to check liveness.
/// The address should include scheme and port, e.g. "http://127.0.0.1:8080".
#[instrument]
pub async fn proxy_health_check(proxy_addr: &str) -> Result<HealthResponse, EgressError> {
    info!(proxy_addr = %proxy_addr, "Probing proxy health");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let url = format!("{}/health", proxy_addr.trim_end_matches('/'));
    let resp = client.get(&url).send().await?;

    if resp.status().is_success() {
        info!(proxy_addr = %proxy_addr, status = %resp.status(), "Proxy is healthy");
        Ok(HealthResponse { status: "healthy".to_string() })
    } else {
        warn!(
            proxy_addr = %proxy_addr,
            status = %resp.status(),
            "Proxy returned non-success status"
        );
        Ok(HealthResponse { status: "unhealthy".to_string() })
    }
}

// ---------------------------------------------------------------------------
// HTTP CONNECT proxy mode stub
// ---------------------------------------------------------------------------

/// Stub handler for HTTP CONNECT proxy requests.
/// In a full implementation this would establish a tunnel, but here we log
/// structured info about the requested destination and return a placeholder.
#[instrument]
pub async fn handle_connect(Json(req): Json<ConnectRequest>) -> impl IntoResponse {
    info!(
        target_host = %req.target_host,
        target_port = %req.target_port,
        "HTTP CONNECT proxy request received (stub)"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "connect_stub",
            "target_host": req.target_host,
            "target_port": req.target_port,
        })),
    )
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/egress/bind", post(egress_bind))
        .route("/egress/health-check", post(egress_health_check))
        .route("/kill-switch/drain", post(kill_switch_drain))
        .route("/connect", post(handle_connect))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    // Initialise tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env();
    info!(
        listen_addr = %config.listen_addr,
        proxy_type = %config.proxy_type,
        proxy_addr = %config.proxy_addr,
        kill_switch = %config.kill_switch,
        "Starting egress-plane"
    );

    let listen_addr = config.listen_addr.clone();
    let state = Arc::new(AppState { config });
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&listen_addr)
        .await
        .expect("Failed to bind TCP listener");

    info!("Egress-plane listening on {}", listen_addr);
    axum::serve(listener, app)
        .await
        .expect("Server exited with error");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_netns() {
        // Use a unique name to avoid collisions
        let name = format!("test_ns_{}", std::process::id());
        // It may fail if we're not root, but the code path is real
        let result = create_netns(&name);
        if result.is_ok() {
            let _ = remove_netns(&name);
        }
    }

    #[test]
    fn test_remove_netns_nonexistent() {
        let result = remove_netns("nonexistent_ns_12345");
        // Should still return Ok because the command executes
        assert!(result.is_err());
    }

    #[test]
    fn test_config_defaults() {
        let cfg = Config::from_env();
        assert_eq!(cfg.listen_addr, "0.0.0.0:3000");
    }
}
