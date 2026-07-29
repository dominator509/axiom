use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tracing::info;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Invalid position: {0}")]
    InvalidPosition(String),

    #[error("Serde JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl IntoResponse for MediaError {
    fn into_response(self) -> axum::response::Response {
        let (status, body) = match &self {
            Self::Io(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("I/O error: {e}"))
            }
            Self::Image(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Image error: {e}"))
            }
            Self::UnsupportedFormat(f) => {
                (StatusCode::BAD_REQUEST, format!("Unsupported format: {f}"))
            }
            Self::InvalidPosition(p) => {
                (StatusCode::BAD_REQUEST, format!("Invalid position: {p}"))
            }
            Self::Json(e) => {
                (StatusCode::BAD_REQUEST, format!("JSON error: {e}"))
            }
        };
        (status, Json(serde_json::json!({ "error": body }))).into_response()
    }
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------
#[derive(Deserialize)]
struct TranscodeRequest {
    input_path: String,
    target_format: String,
    output_path: String,
}

#[derive(Deserialize)]
struct WatermarkRequest {
    image_path: String,
    watermark_path: String,
    output_path: String,
    #[serde(default = "default_position")]
    position: String,
}

fn default_position() -> String {
    "bottom-right".to_string()
}

#[derive(Deserialize)]
struct ResizeRequest {
    image_path: String,
    width: u32,
    height: u32,
    output_path: String,
}

#[derive(Deserialize)]
struct ClipRequest {
    image_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    output_path: String,
}

#[derive(Deserialize)]
struct HashRequest {
    image_path: String,
}

#[derive(Serialize)]
struct HashResponse {
    hash: String,
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ---------------------------------------------------------------------------
// /media/transcode
// ---------------------------------------------------------------------------

async fn transcode(
    Json(req): Json<TranscodeRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "transcode: {} -> {} ({})",
        req.input_path, req.output_path, req.target_format
    );

    let img = image::open(&req.input_path)?;

    match req.target_format.to_lowercase().as_str() {
        "png" => img.save(&req.output_path)?,
        "jpeg" | "jpg" => img.save(&req.output_path)?,
        other => return Err(MediaError::UnsupportedFormat(other.to_string())),
    }

    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// ---------------------------------------------------------------------------
// /media/watermark
// ---------------------------------------------------------------------------

async fn watermark(
    Json(req): Json<WatermarkRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "watermark: {} + {} -> {} (position: {})",
        req.image_path, req.watermark_path, req.output_path, req.position
    );

    let mut base = image::open(&req.image_path)?;
    let watermark_img = image::open(&req.watermark_path)?;

    let (base_w, base_h) = (base.width(), base.height());
    let (wm_w, wm_h) = (watermark_img.width(), watermark_img.height());

    let (x, y) = match req.position.to_lowercase().as_str() {
        "top-left" => (0, 0),
        "top-right" => (base_w.saturating_sub(wm_w), 0),
        "bottom-left" => (0, base_h.saturating_sub(wm_h)),
        "bottom-right" => (base_w.saturating_sub(wm_w), base_h.saturating_sub(wm_h)),
        "center" => (
            (base_w.saturating_sub(wm_w)) / 2,
            (base_h.saturating_sub(wm_h)) / 2,
        ),
        other => return Err(MediaError::InvalidPosition(other.to_string())),
    };

    image::imageops::overlay(&mut base, &watermark_img, x as i64, y as i64);
    base.save(&req.output_path)?;

    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// ---------------------------------------------------------------------------
// /media/resize
// ---------------------------------------------------------------------------

async fn resize(
    Json(req): Json<ResizeRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "resize: {} -> {} ({}x{})",
        req.image_path, req.output_path, req.width, req.height
    );

    let img = image::open(&req.image_path)?;
    let resized = img.resize_exact(req.width, req.height, image::imageops::FilterType::Lanczos3);
    resized.save(&req.output_path)?;

    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// ---------------------------------------------------------------------------
// /media/clip
// ---------------------------------------------------------------------------

async fn clip(
    Json(req): Json<ClipRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "clip: {} -> {} (x:{} y:{} w:{} h:{})",
        req.image_path, req.output_path, req.x, req.y, req.width, req.height
    );

    let img = image::open(&req.image_path)?;
    let cropped = img.crop_imm(req.x, req.y, req.width, req.height);
    cropped.save(&req.output_path)?;

    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// ---------------------------------------------------------------------------
// /media/compute-hash
// ---------------------------------------------------------------------------

async fn compute_hash(
    Json(req): Json<HashRequest>,
) -> Result<Json<HashResponse>, MediaError> {
    info!("compute-hash: {}", req.image_path);

    let bytes = tokio::fs::read(&req.image_path).await?;
    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .concat()
    };

    Ok(Json(HashResponse { hash }))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/media/transcode", post(transcode))
        .route("/media/watermark", post(watermark))
        .route("/media/resize", post(resize))
        .route("/media/clip", post(clip))
        .route("/media/compute-hash", post(compute_hash));

    let addr = "0.0.0.0:3000";
    info!("media-plane listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
