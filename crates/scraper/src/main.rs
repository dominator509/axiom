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
    let counts = parse_profile_counts(&html);

    // Fill in structured data from the parse or use defaults
    let now = chrono_now_iso();
    let response = SocialScrapeResponse {
        platform: req.platform,
        profile_url: req.profile_url,
        display_name,
        bio,
        avatar_url,
        followers: counts.followers.unwrap_or(0),
        following: counts.following.unwrap_or(0),
        posts: counts.posts.unwrap_or(0),
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
                let counts = parse_profile_counts(&html);
                CompetitorResult {
                    platform: platform.clone(),
                    profile_url,
                    followers: counts.followers.unwrap_or(0),
                    posts: counts.posts.unwrap_or(0),
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

/// Counts extracted from a profile page (real values when the page exposes
/// them; `None` when the platform does not surface the metric in HTML).
#[derive(Debug, Default, Clone, Copy)]
struct ProfileCounts {
    followers: Option<u64>,
    following: Option<u64>,
    posts: Option<u64>,
}

/// Parse a human-readable count like "1.2M", "4,500", "300" into a u64.
fn parse_count(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let lower = raw.to_lowercase();
    let multiplier: f64 = if lower.contains('m') {
        1_000_000.0
    } else if lower.contains('k') {
        1_000.0
    } else if lower.contains('b') {
        1_000_000_000.0
    } else {
        1.0
    };
    let cleaned: String = lower
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let value: f64 = cleaned.parse().ok()?;
    Some((value * multiplier).round() as u64)
}

/// Extract metrics from the page's embedded JSON (TikTok `__UNIVERSAL_DATA_...`,
/// YouTube `ytInitialData`, generic `"followerCount"` fields).
fn parse_embedded_json(html: &str) -> ProfileCounts {
    let mut counts = ProfileCounts::default();

    // Common rehydration keys across platforms. Field access by index avoids
    // overlapping mutable borrows.
    let find = |html: &str, key: &str| -> Option<u64> {
        let pattern = format!(r#""{key}"\s*:\s*(\d+)"#);
        let re = regex::Regex::new(&pattern).ok()?;
        let cap = re.captures(html)?;
        cap.get(1)?.as_str().parse::<u64>().ok()
    };

    for key in ["followerCount", "edge_followed_by"] {
        if counts.followers.is_none() {
            counts.followers = find(html, key);
        }
    }
    for key in ["followingCount", "edge_follow"] {
        if counts.following.is_none() {
            counts.following = find(html, key);
        }
    }
    for key in ["videoCount", "edge_owner_to_timeline_media"] {
        if counts.posts.is_none() {
            counts.posts = find(html, key);
        }
    }

    // YouTube: subscriberCountText / videoCountText are human strings, often
    // nested inside JSON objects — scan the whole HTML for the label pattern.
    if counts.followers.is_none() {
        if let Ok(re) = regex::Regex::new(r#"(?i)"subscriberCountText"\s*:\s*"([^"]+)"|([\d.,]+[kmb]?)\s+subscribers?"#) {
            if let Some(cap) = re.captures(html) {
                let raw = cap
                    .get(1)
                    .or_else(|| cap.get(2))
                    .map(|m| m.as_str());
                if let Some(raw) = raw {
                    counts.followers = parse_count(raw);
                }
            }
        }
    }
    if counts.posts.is_none() {
        if let Ok(re) = regex::Regex::new(r#"(?i)"videoCountText"\s*:\s*"([^"]+)"|([\d.,]+[kmb]?)\s+videos?"#) {
            if let Some(cap) = re.captures(html) {
                let raw = cap
                    .get(1)
                    .or_else(|| cap.get(2))
                    .map(|m| m.as_str());
                if let Some(raw) = raw {
                    counts.posts = parse_count(raw);
                }
            }
        }
    }

    counts
}

/// Extract counts from the meta description (Instagram/X og:description
/// convention: "1.2M Followers, 300 Following, 4,500 Posts").
fn parse_meta_description(html: &str) -> ProfileCounts {
    let mut counts = ProfileCounts::default();
    let doc = scraper_crate::Html::parse_document(html);
    let meta_desc_sel =
        scraper_crate::Selector::parse(r#"meta[name="description"], meta[property="og:description"]"#)
            .unwrap();
    let desc = doc
        .select(&meta_desc_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .unwrap_or("");

    // Case-insensitive label match; also accept platform variants:
    //   followers | subscribers (YouTube) → followers
    //   posts | videos (YouTube)          → posts
    for (labels, target) in [
        (&["followers", "subscribers"][..], &mut counts.followers),
        (&["following"][..], &mut counts.following),
        (&["posts", "videos"][..], &mut counts.posts),
    ] {
        if target.is_some() {
            continue;
        }
        let label_alt = labels.join("|");
        let pattern = format!(r"(?i)([\d.,]+[kmb]?)\s+({label_alt})");
        if let Ok(re) = regex::Regex::new(&pattern) {
            if let Some(cap) = re.captures(desc) {
                if let Some(raw) = cap.get(1) {
                    *target = parse_count(raw.as_str());
                }
            }
        }
    }
    counts
}

/// Full metric extraction for a profile page: embedded JSON first (exact),
/// then the meta-description convention (rounded human counts).
fn parse_profile_counts(html: &str) -> ProfileCounts {
    let json = parse_embedded_json(html);
    let meta = parse_meta_description(html);
    ProfileCounts {
        followers: json.followers.or(meta.followers),
        following: json.following.or(meta.following),
        posts: json.posts.or(meta.posts),
    }
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

    let addr = std::env::var("AXIOM_SCRAPER_ADDR").unwrap_or_else(|_| "0.0.0.0:8102".to_string());
    info!("scraper listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const INSTAGRAM_HTML: &str = r#"<html><head>
      <title>NASA (@nasa) • Instagram photos and videos</title>
      <meta name="description" content="1.2M Followers, 300 Following, 4,500 Posts - See Instagram photos and videos from NASA (@nasa)">
      <meta property="og:image" content="https://scontent.example/nasa.jpg">
    </head><body></body></html>"#;

    const TIKTOK_HTML: &str = r#"<html><head><title>TikTok</title></head><body>
      <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"__DEFAULT_SCOPE__":{"webapp.user-detail":{"userInfo":{"user":{"id":"1","uniqueId":"nasa","nickname":"NASA"},"stats":{"followerCount":12345678,"followingCount":89,"videoCount":1234}}}}}</script>
    </body></html>"#;

    const YOUTUBE_HTML: &str = r#"<html><head><title>NASA - YouTube</title></head><body>
      <script>var ytInitialData = {"header":{"pageHeaderRenderer":{"content":{"pageHeaderViewModel":{"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"29.7M subscribers"}},{"text":{"content":"8,145 videos"}}]}]}}}}}}}</script>
    </body></html>"#;

    const X_HTML: &str = r#"<html><head>
      <title>NASA (@NASA) / X</title>
      <meta name="description" content="42.7K Followers, 100 Following">
    </head></body></html>"#;

    #[test]
    fn parse_count_handles_suffixes() {
        assert_eq!(parse_count("1.2M"), Some(1_200_000));
        assert_eq!(parse_count("4,500"), Some(4_500));
        assert_eq!(parse_count("300"), Some(300));
        assert_eq!(parse_count("29.7M"), Some(29_700_000));
        assert_eq!(parse_count("8,145"), Some(8_145));
        assert_eq!(parse_count(""), None);
    }

    #[test]
    fn instagram_meta_description_counts() {
        let counts = parse_profile_counts(INSTAGRAM_HTML);
        assert_eq!(counts.followers, Some(1_200_000));
        assert_eq!(counts.following, Some(300));
        assert_eq!(counts.posts, Some(4_500));
    }

    #[test]
    fn instagram_profile_fields() {
        let (name, _bio, avatar) = parse_profile_page(INSTAGRAM_HTML);
        assert!(name.contains("NASA"));
        assert!(avatar.contains("scontent"));
    }

    #[test]
    fn tiktok_rehydration_json_counts() {
        let counts = parse_profile_counts(TIKTOK_HTML);
        assert_eq!(counts.followers, Some(12_345_678));
        assert_eq!(counts.following, Some(89));
        assert_eq!(counts.posts, Some(1_234));
    }

    #[test]
    fn youtube_subscriber_and_video_counts() {
        let counts = parse_profile_counts(YOUTUBE_HTML);
        assert_eq!(counts.followers, Some(29_700_000));
        assert_eq!(counts.posts, Some(8_145));
    }

    #[test]
    fn x_meta_description_counts() {
        let counts = parse_profile_counts(X_HTML);
        assert_eq!(counts.followers, Some(42_700));
        assert_eq!(counts.following, Some(100));
        assert_eq!(counts.posts, None);
    }

    #[test]
    fn empty_page_yields_none() {
        let counts = parse_profile_counts("<html><body></body></html>");
        assert_eq!(counts.followers, None);
        assert_eq!(counts.following, None);
        assert_eq!(counts.posts, None);
    }

    #[test]
    fn build_platform_url_shapes() {
        assert_eq!(build_platform_url("instagram", "NASA"), "https://instagram.com/nasa");
        assert_eq!(build_platform_url("tiktok", "NASA"), "https://tiktok.com/@nasa");
        assert_eq!(build_platform_url("x", "NASA"), "https://x.com/nasa");
        assert_eq!(build_platform_url("fanvue", "Ava"), "https://fanvue.com/ava");
    }
}
