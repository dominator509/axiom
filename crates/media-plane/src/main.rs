use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::Stdio;
use thiserror::Error;
use tokio::process::Command;
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

    #[error("ffmpeg error: {0}")]
    Ffmpeg(String),

    #[error("Input file does not exist: {0}")]
    InputMissing(String),
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
            Self::Ffmpeg(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("ffmpeg error: {e}"))
            }
            Self::InputMissing(p) => {
                (StatusCode::BAD_REQUEST, format!("Input file does not exist: {p}"))
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

// ─── Video (ffmpeg-backed, F-14/F-29) ────────────────────────────────────────

#[derive(Deserialize)]
struct VideoTranscodeRequest {
    input_path: String,
    target_format: String,
    output_path: String,
    /// Optional video bitrate (e.g. "2M"). ffmpeg default when absent.
    video_bitrate: Option<String>,
    /// Optional scale filter (e.g. "1280:720"). ffmpeg default when absent.
    scale: Option<String>,
}

#[derive(Deserialize)]
struct VideoWatermarkRequest {
    video_path: String,
    watermark_path: String,
    output_path: String,
    #[serde(default = "default_position")]
    position: String,
}

#[derive(Deserialize)]
struct VideoClipRequest {
    video_path: String,
    /// Start timestamp in seconds (or "HH:MM:SS").
    start: String,
    /// Duration in seconds (or "HH:MM:SS"). Empty string = to end.
    #[serde(default)]
    duration: String,
    output_path: String,
}

#[derive(Deserialize)]
struct VideoProbeRequest {
    video_path: String,
}

#[derive(Serialize)]
struct VideoProbeResponse {
    exists: bool,
    duration_seconds: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    size_bytes: Option<u64>,
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
// Video handlers (ffmpeg-backed)
// ---------------------------------------------------------------------------

/// Run ffmpeg with the given args, returning stderr on success.
async fn run_ffmpeg(args: &[String]) -> Result<String, MediaError> {
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = Command::new("ffmpeg")
        .args(&arg_refs)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let tail: String = stderr.lines().rev().take(8).collect::<Vec<_>>().join("\n");
        return Err(MediaError::Ffmpeg(format!("status {:?}: {}", output.status.code(), tail)));
    }
    Ok(stderr)
}

async fn ensure_input(path: &str) -> Result<(), MediaError> {
    if !std::path::Path::new(path).exists() {
        return Err(MediaError::InputMissing(path.to_string()));
    }
    Ok(())
}

/// Reuse the ffmpeg position mapping for overlays (bottom-right default).
fn overlay_position(position: &str) -> Result<&'static str, MediaError> {
    Ok(match position.to_lowercase().as_str() {
        "top-left" => "10:10",
        "top-right" => "W-w-10:10",
        "bottom-left" => "10:H-h-10",
        "bottom-right" => "W-w-10:H-h-10",
        "center" => "(W-w)/2:(H-h)/2",
        other => return Err(MediaError::InvalidPosition(other.to_string())),
    })
}

// /media/video/transcode
async fn video_transcode(
    Json(req): Json<VideoTranscodeRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "video transcode: {} -> {} ({})",
        req.input_path, req.output_path, req.target_format
    );
    ensure_input(&req.input_path).await?;

    let fmt = req.target_format.to_lowercase();
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        req.input_path.clone(),
    ];
    if let Some(scale) = &req.scale {
        args.push("-vf".into());
        args.push(format!("scale={scale}"));
    }
    if let Some(br) = &req.video_bitrate {
        args.push("-b:v".into());
        args.push(br.clone());
    }
    args.push("-f".into());
    args.push(fmt.clone());
    args.push(req.output_path.clone());

    run_ffmpeg(&args).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path, "format": fmt })))
}

// /media/video/watermark
async fn video_watermark(
    Json(req): Json<VideoWatermarkRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "video watermark: {} + {} -> {} (position: {})",
        req.video_path, req.watermark_path, req.output_path, req.position
    );
    ensure_input(&req.video_path).await?;
    ensure_input(&req.watermark_path).await?;
    let pos = overlay_position(&req.position)?;

    let filter = format!("overlay={pos}");
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        req.video_path.clone(),
        "-i".into(),
        req.watermark_path.clone(),
        "-filter_complex".into(),
        filter,
        "-codec:a".into(),
        "copy".into(),
        req.output_path.clone(),
    ];
    run_ffmpeg(&args).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// /media/video/clip
async fn video_clip(
    Json(req): Json<VideoClipRequest>,
) -> Result<Json<serde_json::Value>, MediaError> {
    info!(
        "video clip: {} -> {} (start: {} duration: {})",
        req.video_path, req.output_path, req.start, req.duration
    );
    ensure_input(&req.video_path).await?;

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        req.start.clone(),
        "-i".into(),
        req.video_path.clone(),
        "-c".into(),
        "copy".into(),
    ];
    if !req.duration.is_empty() {
        args.push("-t".into());
        args.push(req.duration.clone());
    }
    args.push(req.output_path.clone());

    run_ffmpeg(&args).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "output_path": req.output_path })))
}

// /media/video/probe
async fn video_probe(
    Json(req): Json<VideoProbeRequest>,
) -> Result<Json<VideoProbeResponse>, MediaError> {
    info!("video probe: {}", req.video_path);

    if !std::path::Path::new(&req.video_path).exists() {
        return Ok(Json(VideoProbeResponse {
            exists: false,
            duration_seconds: None,
            width: None,
            height: None,
            size_bytes: None,
        }));
    }

    let metadata = tokio::fs::metadata(&req.video_path).await?;
    let ffprobe = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            &req.video_path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&ffprobe.stdout).to_string();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_default();
    let duration_seconds = parsed
        .pointer("/format/duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok());
    let width = parsed
        .pointer("/streams/0/width")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let height = parsed
        .pointer("/streams/0/height")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    Ok(Json(VideoProbeResponse {
        exists: true,
        duration_seconds,
        width,
        height,
        size_bytes: Some(metadata.len()),
    }))
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
        .route("/media/compute-hash", post(compute_hash))
        .route("/media/video/transcode", post(video_transcode))
        .route("/media/video/watermark", post(video_watermark))
        .route("/media/video/clip", post(video_clip))
        .route("/media/video/probe", post(video_probe));

    let addr = std::env::var("AXIOM_MEDIA_ADDR").unwrap_or_else(|_| "0.0.0.0:8100".to_string());
    info!("media-plane listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_position_maps_all_known_positions() {
        assert_eq!(overlay_position("top-left").unwrap(), "10:10");
        assert_eq!(overlay_position("top-right").unwrap(), "W-w-10:10");
        assert_eq!(overlay_position("bottom-left").unwrap(), "10:H-h-10");
        assert_eq!(overlay_position("bottom-right").unwrap(), "W-w-10:H-h-10");
        assert_eq!(overlay_position("center").unwrap(), "(W-w)/2:(H-h)/2");
        assert!(overlay_position("nowhere").is_err());
    }

    #[test]
    fn ensure_input_detects_missing_file() {
        let err = tokio_test_block_on(ensure_input("/nonexistent/nope.png"));
        assert!(matches!(err, Err(MediaError::InputMissing(_))));
    }

    #[test]
    fn video_probe_reports_missing_as_exists_false() {
        let req = VideoProbeRequest {
            video_path: "/nonexistent/nope.mp4".to_string(),
        };
        let result = tokio_test_block_on(video_probe(Json(req)));
        let resp = result.unwrap().0;
        assert!(!resp.exists);
    }

    /// Minimal synchronous block_on for the async helpers under test.
    fn tokio_test_block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(fut)
    }
}
