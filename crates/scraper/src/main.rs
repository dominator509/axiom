use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, instrument, warn};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ScraperError {
    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Serde JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl IntoResponse for ScraperError {
    fn into_response(self) -> axum::response::Response {
        let (status, body) = match &self {
            Self::Http(e) => (
                StatusCode::BAD_GATEWAY,
                format!("HTTP error: {e}"),
            ),
            Self::Io(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("I/O error: {e}"),
            ),
            Self::Parse(p) => (StatusCode::UNPROCESSABLE_ENTITY, format!("Parse error: {p}")),
            Self::Json(e) => (StatusCode::BAD_REQUEST, format!("JSON error: {e}")),
        };
        (status, Json(serde_json::json!({ "error": body }))).into_response()
    }
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SocialScrapeRequest {
    pub platform: String,
    pub profile_url: String,
}

#[derive(Debug, Serialize)]
pub struct SocialScrapeResponse {
    pub platform: String,
    pub profile_url: String,
    pub display_name: String,
    pub bio: String,
    pub avatar_url: String,
    pub followers: u64,
    pub following: u64,
    pub posts: u64,
    pub scraped_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CompetitorRequest {
    pub brand_name: String,
    pub industry: String,
    pub platforms: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CompetitorResult {
    pub platform: String,
    pub profile_url: String,
    pub followers: u64,
    pub posts: u64,
    pub engagement_rate: f64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompetitorResponse {
    pub brand: String,
    pub industry: String,
    pub results: Vec<CompetitorResult>,
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

#[instrument]
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

// ---------------------------------------------------------------------------
// /scrape/social
// ---------------------------------------------------------------------------

#[instrument(skip(req))]
async fn scrape_social(
    Json(req): Json<SocialScrapeRequest>,
) -> Result<Json<SocialScrapeResponse>, ScraperError> {
    info!(
        "scraping social profile: platform={}, url={}",
        req.platform, req.profile_url
    );

    // Attempt to fetch the profile page
    let html = fetch_page(&req.profile_url).await?;

    // Parse with scraper crate to extract what we can
    let (display_name, bio, avatar_url) = parse_profile_page(&html);

    // Fill in structured data from the parse or use defaults
    let now = chrono_now_iso();
    let response = SocialScrapeResponse {
        platform: req.platform,
        profile_url: req.profile_url,
        display_name,
        bio,
        avatar_url,
        followers: 0,
        following: 0,
        posts: 0,
        scraped_at: now,
    };

    info!(
        "scraped profile: name={}, followers={}",
        response.display_name, response.followers
    );
    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// /scrape/competitor
// ---------------------------------------------------------------------------

#[instrument(skip(req))]
async fn scrape_competitor(
    Json(req): Json<CompetitorRequest>,
) -> Result<Json<CompetitorResponse>, ScraperError> {
    info!(
        "competitor benchmarking: brand={}, industry={}, platforms={:?}",
        req.brand_name, req.industry, req.platforms
    );

    let mut results = Vec::with_capacity(req.platforms.len());

    for platform in &req.platforms {
        let profile_url = build_platform_url(platform, &req.brand_name);
        let result = match fetch_page(&profile_url).await {
            Ok(html) => {
                let (_name, _bio, _avatar) = parse_profile_page(&html);
                CompetitorResult {
                    platform: platform.clone(),
                    profile_url,
                    followers: 0,
                    posts: 0,
                    engagement_rate: 0.0,
                    error: None,
                }
            }
            Err(e) => CompetitorResult {
                platform: platform.clone(),
                profile_url,
                followers: 0,
                posts: 0,
                engagement_rate: 0.0,
                error: Some(format!("{e}")),
            },
        };
        results.push(result);
    }

    Ok(Json(CompetitorResponse {
        brand: req.brand_name,
        industry: req.industry,
        results,
    }))
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Fetch a URL and return the HTML body as a string.
async fn fetch_page(url: &str) -> Result<String, ScraperError> {
    info!("fetching: {url}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; AXIOM-Scraper/1.0)")
        .build()?;

    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        warn!("HTTP {} for {}", resp.status(), url);
        return Err(ScraperError::Parse(format!(
            "HTTP {} from {}",
            resp.status(),
            url
        )));
    }
    let text = resp.text().await?;
    Ok(text)
}

/// Parse an HTML profile page using the scraper crate.
/// Extracts <title> as display name, <meta name="description"> as bio,
/// and <meta property="og:image"> as avatar URL.
fn parse_profile_page(html: &str) -> (String, String, String) {
    let doc = scraper_crate::Html::parse_document(html);

    // Title -> display name
    let title_sel = scraper_crate::Selector::parse("title").unwrap();
    let display_name = doc
        .select(&title_sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default();

    // Meta description -> bio
    let meta_desc_sel =
        scraper_crate::Selector::parse(r#"meta[name="description"]"#).unwrap();
    let bio = doc
        .select(&meta_desc_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .unwrap_or("")
        .to_string();

    // og:image -> avatar URL
    let og_image_sel =
        scraper_crate::Selector::parse(r#"meta[property="og:image"]"#).unwrap();
    let avatar_url = doc
        .select(&og_image_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .unwrap_or("")
        .to_string();

    (display_name, bio, avatar_url)
}

/// Build a platform-specific profile URL for a brand name.
fn build_platform_url(platform: &str, brand: &str) -> String {
    let slug = brand.to_lowercase().replace(' ', "");
    match platform.to_lowercase().as_str() {
        "twitter" | "x" => format!("https://x.com/{slug}"),
        "instagram" => format!("https://instagram.com/{slug}"),
        "tiktok" => format!("https://tiktok.com/@{slug}"),
        "youtube" => format!("https://youtube.com/@{slug}"),
        "facebook" => format!("https://facebook.com/{slug}"),
        "fanvue" => format!("https://fanvue.com/{slug}"),
        _ => format!("https://{platform}.com/{slug}"),
    }
}

/// Return the current UTC time as an ISO 8601 string.
fn chrono_now_iso() -> String {
    // Use std::time to produce an ISO-like timestamp rather than pulling in chrono
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Format as ISO 8601-ish: YYYY-MM-DDTHH:MM:SSZ
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Approximate date from Unix epoch (1970-01-01 + days)
    // Simple Gregorian calculation
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let month_days = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md {
            m = i;
            break;
        }
        remaining -= md;
    }
    let d = remaining + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m + 1,
        d,
        hours,
        minutes,
        seconds
    )
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
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
        .route("/scrape/social", post(scrape_social))
        .route("/scrape/competitor", post(scrape_competitor));

    let addr = "0.0.0.0:3000";
    info!("scraper listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
