use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
enum VisionError {
    #[error("Failed to load image at '{0}': {1}")]
    ImageLoad(String, String),

    #[error("Internal computation error: {0}")]
    Internal(String),
}

impl IntoResponse for VisionError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            VisionError::ImageLoad(_, _) => (StatusCode::BAD_REQUEST, self.to_string()),
            VisionError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ImagePathRequest {
    image_path: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
}

#[derive(Debug, Serialize)]
struct TosClassifyResponse {
    verdict: String,
    nsfw_score: f64,
    reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
struct NsfwDetectResponse {
    nsfw_score: f64,
    confidence: f64,
    analysis: Analysis,
}

#[derive(Debug, Serialize)]
struct Analysis {
    dimensions: Dimensions,
    avg_brightness: f64,
    color_variance: f64,
    aspect_ratio: f64,
}

#[derive(Debug, Serialize)]
struct Dimensions {
    width: u32,
    height: u32,
}

// ---------------------------------------------------------------------------
// Image metrics
// ---------------------------------------------------------------------------

struct ImageMetrics {
    width: u32,
    height: u32,
    avg_brightness: f64,
    std_dev_brightness: f64,
    aspect_ratio: f64,
}

fn compute_metrics(path: &str) -> Result<ImageMetrics, VisionError> {
    let img = image::open(Path::new(path))
        .map_err(|e| VisionError::ImageLoad(path.to_string(), e.to_string()))?;

    let (width, height) = img.dimensions();
    let rgb = img.to_rgb8();

    let total_pixels = (width as u64) * (height as u64);
    if total_pixels == 0 {
        return Err(VisionError::Internal("Image has zero pixels".to_string()));
    }

    // Compute luminance for every pixel using Rec. 601 coefficients
    let mut sum: f64 = 0.0;
    let mut sum_sq: f64 = 0.0;

    for pixel in rgb.pixels() {
        let r = pixel[0] as f64;
        let g = pixel[1] as f64;
        let b = pixel[2] as f64;
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += lum;
        sum_sq += lum * lum;
    }

    let n = total_pixels as f64;
    let avg = sum / n;
    let variance = (sum_sq / n) - (avg * avg);
    let std_dev = variance.max(0.0).sqrt();

    let aspect_ratio = if height == 0 {
        0.0
    } else {
        width as f64 / height as f64
    };

    Ok(ImageMetrics {
        width,
        height,
        avg_brightness: avg,
        std_dev_brightness: std_dev,
        aspect_ratio,
    })
}

/// Heuristic NSFW score based on image statistics.
///
/// Darker images and images with moderate-to-high colour variation score higher.
/// Very low variance (solid colour / text / screenshot) scores low.
/// Extreme aspect-ratios add a small penalty.
fn heuristic_nsfw_score(metrics: &ImageMetrics) -> f64 {
    let brightness_factor = (255.0 - metrics.avg_brightness) / 255.0; // 0 (bright) … 1 (dark)

    // variance factor: low variance → text/screenshot (low nsfw)
    let variance_factor = (metrics.std_dev_brightness / 128.0).min(1.0);

    // aspect-ratio penalty: extreme ratios are slightly more suspicious
    let aspect_penalty = if metrics.aspect_ratio > 3.0 || metrics.aspect_ratio < 1.0 / 3.0 {
        0.15
    } else {
        0.0
    };

    let score = brightness_factor * 0.35 + variance_factor * 0.50 + aspect_penalty;
    score.clamp(0.0, 1.0)
}

/// Heuristic confidence — based on how "typical" the image dimensions are.
/// Very small, very large, or extreme-aspect images reduce confidence.
fn heuristic_confidence(metrics: &ImageMetrics) -> f64 {
    let mut confidence: f64 = 1.0;

    if metrics.width < 100 || metrics.height < 100 {
        confidence *= 0.6;
    }
    if metrics.width > 5000 || metrics.height > 5000 {
        confidence *= 0.7;
    }
    if metrics.aspect_ratio > 3.0 || metrics.aspect_ratio < 1.0 / 3.0 {
        confidence *= 0.8;
    }
    if metrics.std_dev_brightness < 20.0 {
        // Very uniform image → heuristic is less reliable
        confidence *= 0.6;
    }

    confidence.clamp(0.1, 1.0)
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

async fn tos_classify(
    Json(req): Json<ImagePathRequest>,
) -> Result<Json<TosClassifyResponse>, VisionError> {
    let metrics = compute_metrics(&req.image_path)?;

    let mut reasons: Vec<String> = Vec::new();
    let mut needs_review = false;

    if metrics.width < 50 || metrics.height < 50 {
        reasons.push(format!(
            "Dimensions too small ({}x{} < 50px)",
            metrics.width, metrics.height
        ));
        needs_review = true;
    }
    if metrics.width > 10000 || metrics.height > 10000 {
        reasons.push(format!(
            "Dimensions too large ({}x{} > 10000px)",
            metrics.width, metrics.height
        ));
        needs_review = true;
    }
    if metrics.aspect_ratio > 3.0 {
        reasons.push(format!(
            "Extreme aspect ratio ({:.2}:1 > 3:1)",
            metrics.aspect_ratio
        ));
        needs_review = true;
    }
    if metrics.std_dev_brightness < 25.0 {
        reasons.push(format!(
            "Low color variance ({:.1} — possible text/screenshot)",
            metrics.std_dev_brightness
        ));
        // Low variance alone flags as review for TOS
        needs_review = true;
    }

    let nsfw_score = heuristic_nsfw_score(&metrics);

    let verdict = if nsfw_score > 0.75 {
        reasons.push(format!("NSFW score ({:.4}) exceeds block threshold", nsfw_score));
        "block".to_string()
    } else if needs_review {
        "review".to_string()
    } else {
        "pass".to_string()
    };

    Ok(Json(TosClassifyResponse {
        verdict,
        nsfw_score,
        reasons,
    }))
}

async fn nsfw_detect(
    Json(req): Json<ImagePathRequest>,
) -> Result<Json<NsfwDetectResponse>, VisionError> {
    let metrics = compute_metrics(&req.image_path)?;

    let nsfw_score = heuristic_nsfw_score(&metrics);
    let confidence = heuristic_confidence(&metrics);

    Ok(Json(NsfwDetectResponse {
        nsfw_score,
        confidence,
        analysis: Analysis {
            dimensions: Dimensions {
                width: metrics.width,
                height: metrics.height,
            },
            avg_brightness: metrics.avg_brightness,
            color_variance: metrics.std_dev_brightness,
            aspect_ratio: metrics.aspect_ratio,
        },
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
                .unwrap_or_else(|_| "vision_engine=info,tower_http=info".into()),
        )
        .init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/vision/tos-classify", post(tos_classify))
        .route("/vision/nsfw-detect", post(nsfw_detect));

    let addr = "0.0.0.0:3000";
    tracing::info!("Vision Engine listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
