use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use image::GenericImageView;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
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

    #[error("ONNX model error: {0}")]
    Onnx(String),

    #[error("Invalid override '{0}' — expected one of: pass, review, block")]
    InvalidOverride(String),

    #[error("Image path is outside the configured media root")]
    InvalidPath,

    #[error("Vision model is unavailable")]
    ModelUnavailable,
}

impl IntoResponse for VisionError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match &self {
            VisionError::ImageLoad(_, _)
            | VisionError::InvalidOverride(_)
            | VisionError::InvalidPath => (StatusCode::BAD_REQUEST, self.to_string()),
            VisionError::Internal(_) | VisionError::Onnx(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
            VisionError::ModelUnavailable => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
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
    /// Optional verdict override: "pass" | "review" | "block".
    /// When present, the model is bypassed and the verdict is forced.
    #[serde(rename = "override", default)]
    override_verdict: Option<String>,
}

#[derive(Debug, Serialize)]
struct TosClassifyResponse {
    verdict: String,
    nsfw_score: f64,
    reasons: Vec<String>,
    engine: String,
    probabilities: Vec<f64>,
    labels: Vec<String>,
    /// True when the verdict was forced by an override (model bypassed).
    overridden: bool,
    /// The applied override source: "request" or "environment".
    override_source: Option<String>,
}

#[derive(Debug, Serialize)]
struct NsfwDetectResponse {
    nsfw_score: f64,
    confidence: f64,
    engine: String,
    probabilities: Vec<f64>,
    labels: Vec<String>,
    analysis: Analysis,
    /// True when the verdict was forced by an override (model bypassed).
    overridden: bool,
    /// The applied override source: "request" or "environment".
    override_source: Option<String>,
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
// Image metrics (statistical pre-analysis — NOT the classifier)
// ---------------------------------------------------------------------------

struct ImageMetrics {
    width: u32,
    height: u32,
    avg_brightness: f64,
    std_dev_brightness: f64,
    aspect_ratio: f64,
}

/// Keep the unauthenticated vision sidecar from becoming a host-file oracle.
/// It shares the same repository-local media boundary as media-plane.
fn media_root() -> Result<PathBuf, VisionError> {
    let root = std::env::current_dir()
        .map_err(|e| VisionError::Internal(e.to_string()))?
        .join("var")
        .join("media");
    std::fs::create_dir_all(&root).map_err(|e| VisionError::Internal(e.to_string()))?;
    root.canonicalize()
        .map_err(|e| VisionError::Internal(e.to_string()))
}

fn resolve_image_path(path: &str) -> Result<PathBuf, VisionError> {
    let root = media_root()?;
    let supplied = Path::new(path);
    let candidate = if supplied.is_absolute() {
        supplied.to_path_buf()
    } else {
        root.join(supplied)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|e| VisionError::ImageLoad(path.to_string(), e.to_string()))?;
    if !canonical.starts_with(&root) {
        return Err(VisionError::InvalidPath);
    }
    Ok(canonical)
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

// ---------------------------------------------------------------------------
// Real vision model (ONNX ViT — onnx-community/nsfw-image-detector-ONNX)
//
// Self-hosted: the model file lives on this box and inference runs in-process
// via ONNX Runtime. This replaces the previous brightness/variance heuristic
// as the primary classifier (L2.1 "self-hosted vision model", L2.10).
// ---------------------------------------------------------------------------

const MODEL_PATH_ENV: &str = "AXIOM_VISION_MODEL";
const DEFAULT_MODEL_PATH: &str = "/opt/axiom/models/nsfw-vit.onnx";
const IMG_SIZE: usize = 224;
const N_CLASSES: usize = 5;

/// Class labels from the model's config id2label.
const LABELS: [&str; N_CLASSES] = ["drawings", "hentai", "neutral", "porn", "sexy"];

/// NSFW classes are everything except neutral/drawings.
const NSFW_CLASSES: [usize; 3] = [1, 3, 4]; // hentai, porn, sexy

struct VisionModel {
    session: Session,
}

static MODEL: OnceLock<std::sync::Mutex<Option<VisionModel>>> = OnceLock::new();

fn model_path() -> String {
    std::env::var(MODEL_PATH_ENV).unwrap_or_else(|_| DEFAULT_MODEL_PATH.to_string())
}

/// Load the ONNX model once at process start. Returns Ok(None) if the model
/// file is absent; production requests then fail closed with ModelUnavailable.
fn load_model() -> Result<Option<&'static std::sync::Mutex<Option<VisionModel>>>, VisionError> {
    let guard = MODEL.get_or_init(|| std::sync::Mutex::new(None));

    let mut inner = guard
        .lock()
        .map_err(|e| VisionError::Internal(format!("model lock poisoned: {e}")))?;

    if inner.is_none() {
        let path = model_path();
        if Path::new(&path).exists() {
            let session = Session::builder()
                .map_err(|e| VisionError::Onnx(e.to_string()))?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| VisionError::Onnx(e.to_string()))?
                .commit_from_file(&path)
                .map_err(|e| VisionError::Onnx(format!("{path}: {e}")))?;
            tracing::info!("vision model loaded from {path}");
            *inner = Some(VisionModel { session });
        } else {
            tracing::warn!("vision model not found at {path} — production inference unavailable");
        }
    }
    let loaded = inner.is_some();
    drop(inner);
    if loaded {
        Ok(Some(guard))
    } else {
        Ok(None)
    }
}

fn softmax(logits: &[f32]) -> Vec<f64> {
    let max = logits.iter().cloned().fold(f32::MIN, f32::max);
    let exps: Vec<f64> = logits.iter().map(|l| ((l - max) as f64).exp()).collect();
    let sum: f64 = exps.iter().sum();
    exps.iter().map(|e| e / sum).collect()
}

/// Preprocess an image exactly as the model's ViTFeatureExtractor:
/// resize to 224x224 (bicubic ≈ CatmullRom), rescale to [0,1], then
/// normalize with mean=0.5, std=0.5 → channel-first CHW float32.
fn preprocess(path: &str) -> Result<Vec<f32>, VisionError> {
    let img = image::open(Path::new(path))
        .map_err(|e| VisionError::ImageLoad(path.to_string(), e.to_string()))?;
    let resized = img.resize_exact(
        IMG_SIZE as u32,
        IMG_SIZE as u32,
        image::imageops::FilterType::CatmullRom,
    );
    let rgb = resized.to_rgb8();

    let channel_size = IMG_SIZE * IMG_SIZE;
    let mut chw = vec![0.0f32; 3 * channel_size];
    for (i, pixel) in rgb.pixels().enumerate() {
        let r = (pixel[0] as f32 / 255.0 - 0.5) / 0.5;
        let g = (pixel[1] as f32 / 255.0 - 0.5) / 0.5;
        let b = (pixel[2] as f32 / 255.0 - 0.5) / 0.5;
        let px = i % IMG_SIZE;
        let py = i / IMG_SIZE;
        let pixel_index = py * IMG_SIZE + px;
        chw[pixel_index] = r;
        chw[channel_size + pixel_index] = g;
        chw[2 * channel_size + pixel_index] = b;
    }
    Ok(chw)
}

/// Run the real model. Returns softmax probabilities over the 5 classes.
fn model_infer(path: &str) -> Result<Vec<f64>, VisionError> {
    let guard = load_model()?
        .ok_or_else(|| VisionError::Internal("vision model not loaded".to_string()))?;

    let pixels = preprocess(path)?;
    let array = ndarray::Array4::from_shape_vec((1, 3, IMG_SIZE, IMG_SIZE), pixels)
        .map_err(|e| VisionError::Internal(e.to_string()))?;

    let tensor =
        TensorRef::from_array_view(&array).map_err(|e| VisionError::Onnx(e.to_string()))?;

    let mut model = guard
        .lock()
        .map_err(|e| VisionError::Internal(format!("model lock poisoned: {e}")))?;
    let vision_model = model
        .as_mut()
        .ok_or_else(|| VisionError::Internal("vision model not loaded".to_string()))?;

    let outputs = vision_model
        .session
        .run(ort::inputs![tensor])
        .map_err(|e| VisionError::Onnx(e.to_string()))?;

    let logits = outputs[0]
        .try_extract_array::<f32>()
        .map_err(|e| VisionError::Onnx(e.to_string()))?;

    let logits_vec: Vec<f32> = logits.iter().cloned().collect();
    Ok(softmax(&logits_vec))
}

/// nsfw_score = P(hentai) + P(porn) + P(sexy)
fn nsfw_from_probs(probs: &[f64]) -> f64 {
    NSFW_CLASSES.iter().map(|&i| probs[i]).sum()
}

/// Confidence = probability of the most-likely NSFW class, or of neutral.
fn confidence_from_probs(probs: &[f64]) -> f64 {
    probs.iter().cloned().fold(0.0f64, f64::max)
}

/// Heuristic NSFW score (legacy fallback when the model is absent).
fn heuristic_nsfw_score(metrics: &ImageMetrics) -> f64 {
    let brightness_factor = (255.0 - metrics.avg_brightness) / 255.0;
    let variance_factor = (metrics.std_dev_brightness / 128.0).min(1.0);
    let aspect_penalty = if metrics.aspect_ratio > 3.0 || metrics.aspect_ratio < 1.0 / 3.0 {
        0.15
    } else {
        0.0
    };
    (brightness_factor * 0.6 + variance_factor * 0.4 + aspect_penalty).min(1.0)
}

fn heuristic_confidence(metrics: &ImageMetrics) -> f64 {
    (metrics.std_dev_brightness / 128.0).min(1.0)
}

// ---------------------------------------------------------------------------
// Override support
//
// Two override sources, request wins over environment:
//   1. Per-request: JSON body  { "image_path": "...", "override": "pass" }
//   2. Global:      env AXIOM_VISION_OVERRIDE=pass|review|block
//
// An override forces the verdict and bypasses the model entirely. The response
// marks `overridden: true` and `override_source` so callers can see the model
// did not produce the decision.
// ---------------------------------------------------------------------------

const OVERRIDE_ENV: &str = "AXIOM_VISION_OVERRIDE";
const OVERRIDE_VALUES: [&str; 3] = ["pass", "review", "block"];

/// Resolve the effective override. Returns (verdict, source) or None.
fn resolve_override(
    request_override: &Option<String>,
) -> Result<Option<(String, String)>, VisionError> {
    let raw = request_override
        .clone()
        .or_else(|| std::env::var(OVERRIDE_ENV).ok())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty() && s != "off" && s != "none" && s != "null");

    match raw {
        None => Ok(None),
        Some(value) => {
            if OVERRIDE_VALUES.contains(&value.as_str()) {
                let source = if request_override.is_some() {
                    "request"
                } else {
                    "environment"
                };
                Ok(Some((value, source.to_string())))
            } else {
                Err(VisionError::InvalidOverride(value))
            }
        }
    }
}

/// Shared evaluation: model-backed production inference (test-only heuristic),
/// then optional override.
/// Returns the pieces both response shapes need.
struct Evaluation {
    verdict: String,
    nsfw_score: f64,
    confidence: f64,
    engine: String,
    probabilities: Vec<f64>,
    reasons: Vec<String>,
    overridden: bool,
    override_source: Option<String>,
}

fn evaluate(path: &str, request_override: &Option<String>) -> Result<Evaluation, VisionError> {
    let image_path = resolve_image_path(path)?;
    let image_path = image_path
        .to_str()
        .ok_or(VisionError::InvalidPath)?;
    let metrics = compute_metrics(image_path)?;
    let mut reasons: Vec<String> = Vec::new();
    let mut needs_review = false;

    // Statistical pre-analysis (dimension/sanity checks only).
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

    // Override short-circuits before any inference.
    if let Some((verdict, source)) = resolve_override(request_override)? {
        let mapped_score = match verdict.as_str() {
            "pass" => 0.0,
            "review" => 0.5,
            _ => 1.0,
        };
        reasons.push(format!(
            "Verdict overridden by {source} to '{verdict}' — model bypassed"
        ));
        return Ok(Evaluation {
            verdict,
            nsfw_score: mapped_score,
            confidence: 1.0,
            engine: "override".to_string(),
            probabilities: Vec::new(),
            reasons,
            overridden: true,
            override_source: Some(source),
        });
    }

    // Primary engine: the real ONNX vision model.
    let (engine, probs, nsfw_score, confidence) = match load_model()? {
        Some(_) => {
            let probs = model_infer(image_path)?;
            let score = nsfw_from_probs(&probs);
            let conf = confidence_from_probs(&probs);
            ("onnx-vit", probs, score, conf)
        }
        None if cfg!(test) => {
            let score = heuristic_nsfw_score(&metrics);
            let conf = heuristic_confidence(&metrics);
            let probs = vec![0.0; N_CLASSES];
            ("heuristic", probs, score, conf)
        }
        None => return Err(VisionError::ModelUnavailable),
    };

    if engine == "heuristic" {
        reasons.push("vision model unavailable — heuristic fallback used".to_string());
    }

    let verdict = if nsfw_score > 0.75 {
        reasons.push(format!(
            "NSFW probability ({:.4}) exceeds block threshold",
            nsfw_score
        ));
        "block".to_string()
    } else if nsfw_score > 0.5 {
        reasons.push(format!(
            "NSFW probability ({:.4}) exceeds review threshold",
            nsfw_score
        ));
        "review".to_string()
    } else if needs_review {
        "review".to_string()
    } else {
        "pass".to_string()
    };

    Ok(Evaluation {
        verdict,
        nsfw_score,
        confidence,
        engine: engine.to_string(),
        probabilities: probs,
        reasons,
        overridden: false,
        override_source: None,
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health() -> axum::response::Response {
    let loaded = load_model().map(|m| m.is_some()).unwrap_or(false);
    let status = if loaded {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(serde_json::json!({
            "status": if loaded { "ok" } else { "unavailable" },
            "model_loaded": loaded,
        })),
    )
        .into_response()
}

async fn tos_classify(
    Json(req): Json<ImagePathRequest>,
) -> Result<Json<TosClassifyResponse>, VisionError> {
    let ev = evaluate(&req.image_path, &req.override_verdict)?;

    Ok(Json(TosClassifyResponse {
        verdict: ev.verdict,
        nsfw_score: ev.nsfw_score,
        reasons: ev.reasons,
        engine: ev.engine,
        probabilities: ev.probabilities,
        labels: LABELS.iter().map(|s| s.to_string()).collect(),
        overridden: ev.overridden,
        override_source: ev.override_source,
    }))
}

async fn nsfw_detect(
    Json(req): Json<ImagePathRequest>,
) -> Result<Json<NsfwDetectResponse>, VisionError> {
    let metrics = compute_metrics(&req.image_path)?;
    let ev = evaluate(&req.image_path, &req.override_verdict)?;

    Ok(Json(NsfwDetectResponse {
        nsfw_score: ev.nsfw_score,
        confidence: ev.confidence,
        engine: ev.engine,
        probabilities: ev.probabilities,
        labels: LABELS.iter().map(|s| s.to_string()).collect(),
        analysis: Analysis {
            dimensions: Dimensions {
                width: metrics.width,
                height: metrics.height,
            },
            avg_brightness: metrics.avg_brightness,
            color_variance: metrics.std_dev_brightness,
            aspect_ratio: metrics.aspect_ratio,
        },
        overridden: ev.overridden,
        override_source: ev.override_source,
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

    // Load (or detect absence of) the model at startup.
    match load_model() {
        Ok(Some(_)) => tracing::info!("vision engine: ONNX model ready"),
        Ok(None) => {
            tracing::warn!("vision engine: no model file — production inference unavailable")
        }
        Err(e) => tracing::error!("vision engine: model load error: {e}"),
    }

    let app = Router::new()
        .route("/health", get(health))
        .route("/vision/tos-classify", post(tos_classify))
        .route("/vision/nsfw-detect", post(nsfw_detect));

    let addr = std::env::var("AXIOM_VISION_ADDR").unwrap_or_else(|_| "127.0.0.1:8101".to_string());
    tracing::info!("Vision Engine listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app).await.expect("Server error");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_media_path(name: &str) -> PathBuf {
        let root = media_root().expect("media root");
        root.join(name)
    }

    #[test]
    fn softmax_normalizes_and_orders() {
        let probs = softmax(&[0.0f32, 1.0, 2.0]);
        assert!((probs.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        assert!(probs[2] > probs[1] && probs[1] > probs[0]);
    }

    #[test]
    fn nsfw_score_sums_nsfw_classes() {
        // neutral-dominant → low score
        let neutral = [0.05, 0.05, 0.85, 0.02, 0.03];
        assert!(nsfw_from_probs(&neutral) < 0.2);
        // porn-dominant → high score
        let nsfw = [0.01, 0.02, 0.03, 0.90, 0.04];
        assert!(nsfw_from_probs(&nsfw) > 0.9);
    }

    #[test]
    fn preprocess_matches_expected_shape_and_normalization() {
        // 224x224 white image → all channels = (1.0 - 0.5)/0.5 = 1.0
        let img = image::RgbImage::from_pixel(224, 224, image::Rgb([255, 255, 255]));
        img.save("/tmp/preprocess-white.png").unwrap();
        let pixels = preprocess("/tmp/preprocess-white.png").unwrap();
        assert_eq!(pixels.len(), 3 * 224 * 224);
        let r = pixels[0];
        let g = pixels[1 * 224 * 224];
        let b = pixels[2 * 224 * 224];
        assert!((r - 1.0).abs() < 1e-3);
        assert!((g - 1.0).abs() < 1e-3);
        assert!((b - 1.0).abs() < 1e-3);
    }

    #[test]
    fn heuristic_fallback_never_panics() {
        let m = ImageMetrics {
            width: 100,
            height: 100,
            avg_brightness: 200.0,
            std_dev_brightness: 30.0,
            aspect_ratio: 1.0,
        };
        let score = heuristic_nsfw_score(&m);
        assert!((0.0..=1.0).contains(&score));
    }

    // ── Override support ────────────────────────────────────────────────

    #[test]
    fn resolve_override_accepts_valid_values() {
        for value in ["pass", "review", "block"] {
            let resolved = resolve_override(&Some(value.to_string())).unwrap();
            let (verdict, source) = resolved.expect("override should resolve");
            assert_eq!(verdict, value);
            assert_eq!(source, "request");
        }
    }

    #[test]
    fn resolve_override_rejects_invalid_values() {
        for value in ["allow", "skip", "banana", "PASS", " Pass "] {
            // "PASS" normalizes to "pass" and is valid — only true garbage is rejected.
            let normalized = value.trim().to_lowercase();
            if ["pass", "review", "block"].contains(&normalized.as_str()) {
                continue;
            }
            assert!(
                matches!(
                    resolve_override(&Some(value.to_string())),
                    Err(VisionError::InvalidOverride(_))
                ),
                "expected InvalidOverride for {value:?}"
            );
        }
    }

    #[test]
    fn resolve_override_reads_environment_when_no_request_override() {
        // Guard: set a known env value, ensure it wins when no request override.
        unsafe {
            std::env::set_var(OVERRIDE_ENV, "block");
        }
        let resolved = resolve_override(&None)
            .unwrap()
            .expect("env override should resolve");
        assert_eq!(resolved.0, "block");
        assert_eq!(resolved.1, "environment");

        // Per-request override wins over env.
        let resolved = resolve_override(&Some("pass".to_string()))
            .unwrap()
            .expect("request override should resolve");
        assert_eq!(resolved.0, "pass");
        assert_eq!(resolved.1, "request");
        unsafe {
            std::env::remove_var(OVERRIDE_ENV);
        }
    }

    #[test]
    fn evaluate_override_forces_verdict_and_bypasses_model() {
        // Use a tiny real image so compute_metrics succeeds; override means
        // the model is never consulted (engine = "override").
        let img = image::RgbImage::from_pixel(64, 64, image::Rgb([10, 10, 10]));
        let path = test_media_path("override-test.png");
        img.save(&path).unwrap();

        let ev = evaluate(path.to_str().unwrap(), &Some("pass".to_string())).unwrap();
        assert_eq!(ev.verdict, "pass");
        assert_eq!(ev.engine, "override");
        assert!(ev.overridden);
        assert_eq!(ev.override_source.as_deref(), Some("request"));
        assert!(ev.probabilities.is_empty());
        assert_eq!(ev.nsfw_score, 0.0);
        assert!(
            ev.reasons
                .iter()
                .any(|r| r.contains("overridden by request")),
            "reasons should state the override: {:?}",
            ev.reasons
        );

        let ev = evaluate(path.to_str().unwrap(), &Some("block".to_string())).unwrap();
        assert_eq!(ev.verdict, "block");
        assert_eq!(ev.nsfw_score, 1.0);
        assert!(ev.overridden);
    }

    #[test]
    fn evaluate_without_override_uses_heuristic_when_model_absent() {
        // No model file is guaranteed in the unit-test environment, and no
        // override → heuristic path must still produce a sane verdict.
        let img = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 200, 200]));
        let path = test_media_path("no-override-test.png");
        img.save(&path).unwrap();
        let ev = evaluate(path.to_str().unwrap(), &None).unwrap();
        assert!(!ev.overridden);
        assert!(matches!(ev.engine.as_str(), "onnx-vit" | "heuristic"));
        assert!(matches!(ev.verdict.as_str(), "pass" | "review" | "block"));
    }

    #[test]
    fn evaluate_rejects_files_outside_media_root() {
        let outside = std::env::temp_dir().join("axiom-vision-outside.png");
        let img = image::RgbImage::from_pixel(64, 64, image::Rgb([10, 10, 10]));
        img.save(&outside).unwrap();
        assert!(matches!(
            evaluate(outside.to_str().unwrap(), &Some("pass".to_string())),
            Err(VisionError::InvalidPath)
        ));
        let _ = std::fs::remove_file(outside);
    }
}
