use axum::{
    extract::{Json, Request},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    response::Response,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, instrument, warn};

const SCRAPER_AUTH_TOKEN_ENV: &str = "AXIOM_SCRAPER_AUTH_TOKEN";
const MAX_PROFILE_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMPETITOR_PLATFORMS: usize = 10;

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
            Self::Http(e) => (StatusCode::BAD_GATEWAY, format!("HTTP error: {e}")),
            Self::Io(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("I/O error: {e}")),
            Self::Parse(p) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("Parse error: {p}"),
            ),
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
    pub model_id: String,
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
    pub followers: Option<u64>,
    pub following: Option<u64>,
    pub posts: Option<u64>,
    pub scraped_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CompetitorRequest {
    pub model_id: String,
    pub brand_name: String,
    pub industry: String,
    pub platforms: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CompetitorResult {
    pub platform: String,
    pub profile_url: String,
    pub followers: Option<u64>,
    pub posts: Option<u64>,
    pub engagement_rate: Option<f64>,
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
    let proxy = resolve_model_proxy(&req.model_id).await?;
    let html = fetch_page(&req.profile_url, &proxy).await?;

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
        followers: counts.followers,
        following: counts.following,
        posts: counts.posts,
        scraped_at: now,
    };

    info!(
        "scraped profile: name={}, followers={:?}",
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

    validate_competitor_platforms(&req.platforms)?;
    let proxy = resolve_model_proxy(&req.model_id).await?;

    let brand = req.brand_name.clone();
    let results = collect_profile_results(req.platforms, move |platform| {
        let profile_url = build_platform_url(&platform, &brand);
        let proxy = proxy.clone();
        async move {
            match fetch_page(&profile_url, &proxy).await {
                Ok(html) => {
                    let counts = parse_profile_counts(&html);
                    CompetitorResult {
                        platform: platform.clone(),
                        profile_url,
                        followers: counts.followers,
                        posts: counts.posts,
                        engagement_rate: None,
                        error: None,
                    }
                }
                Err(e) => CompetitorResult {
                    platform: platform.clone(),
                    profile_url,
                    followers: None,
                    posts: None,
                    engagement_rate: None,
                    error: Some(format!("{e}")),
                },
            }
        }
    })
    .await?;

    Ok(Json(CompetitorResponse {
        brand: req.brand_name,
        industry: req.industry,
        results,
    }))
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

// At most ten independent public-page lookups. Concurrent requests fit inside the
// worker's 30s deadline (5s egress lookup + 15s page fetch), without multiplying
// that deadline by the number of providers. Dropping the set aborts unfinished work.
async fn collect_profile_results<F, Fut>(
    platforms: Vec<String>,
    fetch: F,
) -> Result<Vec<CompetitorResult>, ScraperError>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = CompetitorResult> + Send + 'static,
{
    validate_competitor_platforms(&platforms)?;
    let mut pending = tokio::task::JoinSet::new();
    for (index, platform) in platforms.into_iter().enumerate() {
        let request = fetch(platform);
        pending.spawn(async move { (index, request.await) });
    }
    let mut results = Vec::new();
    while let Some(result) = pending.join_next().await {
        results.push(result.map_err(|_| ScraperError::Parse("profile lookup task failed".into()))?);
    }
    results.sort_by_key(|(index, _)| *index);
    Ok(results.into_iter().map(|(_, result)| result).collect())
}

fn proxy_from_status(status: &serde_json::Value, model_id: &str) -> Result<String, ScraperError> {
    let denied = || ScraperError::Parse("model egress is unavailable or halted".to_string());
    if status.get("kill_switch").and_then(|v| v.as_bool()) != Some(false) {
        return Err(denied());
    }
    let models = status
        .get("models")
        .and_then(|v| v.as_array())
        .ok_or_else(denied)?;
    let model = models
        .iter()
        .find(|m| m.get("model_id").and_then(|v| v.as_str()) == Some(model_id))
        .ok_or_else(denied)?;
    if model.get("healthy").and_then(|v| v.as_bool()) != Some(true) {
        return Err(denied());
    }
    let ip: std::net::IpAddr = model
        .get("host_ip")
        .and_then(|v| v.as_str())
        .ok_or_else(denied)?
        .parse()
        .map_err(|_| denied())?;
    Ok(format!("http://{}", std::net::SocketAddr::new(ip, 8080)))
}

async fn resolve_model_proxy(model_id: &str) -> Result<String, ScraperError> {
    if model_id.len() != 36
        || !model_id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err(ScraperError::Parse(
            "a valid model_id is required".to_string(),
        ));
    }
    let origin =
        std::env::var("EGRESS_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:9090".to_string());
    let token = std::env::var("EGRESS_PLANE_TOKEN").unwrap_or_default();
    if token.trim().is_empty() {
        return Err(ScraperError::Parse(
            "egress authentication is not configured".to_string(),
        ));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let mut response = client
        .get(format!("{}/egress/status", origin.trim_end_matches('/')))
        .header("x-egress-plane-token", token.trim())
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(ScraperError::Parse(
            "egress status request failed".to_string(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 512 * 1024 {
            return Err(ScraperError::Parse(
                "egress status exceeds size limit".to_string(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let status: serde_json::Value = serde_json::from_slice(&bytes)?;
    proxy_from_status(&status, model_id)
}

/// Fetch a URL only through the model's authenticated egress-plane binding.
async fn fetch_page(url: &str, proxy: &str) -> Result<String, ScraperError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| ScraperError::Parse("invalid profile URL".to_string()))?;
    if parsed.scheme() != "https" || !is_allowed_profile_host(parsed.host_str()) {
        return Err(ScraperError::Parse(
            "profile URL must use HTTPS on a supported platform host".to_string(),
        ));
    }
    info!("fetching: {url}");
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(proxy)?)
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            let next = attempt.url();
            if next.scheme() == "https" && is_allowed_profile_host(next.host_str()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
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
    if resp
        .content_length()
        .map(|length| length > MAX_PROFILE_BODY_BYTES as u64)
        .unwrap_or(false)
    {
        return Err(ScraperError::Parse(format!(
            "profile response exceeds {MAX_PROFILE_BODY_BYTES} bytes"
        )));
    }

    let mut body = Vec::new();
    let mut resp = resp;
    while let Some(chunk) = resp.chunk().await? {
        append_limited_body(&mut body, &chunk)?;
    }

    String::from_utf8(body)
        .map_err(|_| ScraperError::Parse("profile response is not valid UTF-8".to_string()))
}

fn validate_competitor_platforms(platforms: &[String]) -> Result<(), ScraperError> {
    if platforms.is_empty() || platforms.len() > MAX_COMPETITOR_PLATFORMS {
        return Err(ScraperError::Parse(format!(
            "platforms must contain between 1 and {MAX_COMPETITOR_PLATFORMS} entries"
        )));
    }
    Ok(())
}

fn append_limited_body(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), ScraperError> {
    if body.len().saturating_add(chunk.len()) > MAX_PROFILE_BODY_BYTES {
        return Err(ScraperError::Parse(format!(
            "profile response exceeds {MAX_PROFILE_BODY_BYTES} bytes"
        )));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn is_allowed_profile_host(host: Option<&str>) -> bool {
    matches!(
        host.map(|value| value.to_ascii_lowercase()).as_deref(),
        Some(
            "x.com"
                | "www.x.com"
                | "twitter.com"
                | "www.twitter.com"
                | "instagram.com"
                | "www.instagram.com"
                | "tiktok.com"
                | "www.tiktok.com"
                | "youtube.com"
                | "www.youtube.com"
                | "facebook.com"
                | "www.facebook.com"
                | "fanvue.com"
                | "www.fanvue.com"
        )
    )
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
    let meta_desc_sel = scraper_crate::Selector::parse(r#"meta[name="description"]"#).unwrap();
    let bio = doc
        .select(&meta_desc_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .unwrap_or("")
        .to_string();

    // og:image -> avatar URL
    let og_image_sel = scraper_crate::Selector::parse(r#"meta[property="og:image"]"#).unwrap();
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
        if let Ok(re) = regex::Regex::new(
            r#"(?i)"subscriberCountText"\s*:\s*"([^"]+)"|([\d.,]+[kmb]?)\s+subscribers?"#,
        ) {
            if let Some(cap) = re.captures(html) {
                let raw = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str());
                if let Some(raw) = raw {
                    counts.followers = parse_count(raw);
                }
            }
        }
    }
    if counts.posts.is_none() {
        if let Ok(re) =
            regex::Regex::new(r#"(?i)"videoCountText"\s*:\s*"([^"]+)"|([\d.,]+[kmb]?)\s+videos?"#)
        {
            if let Some(cap) = re.captures(html) {
                let raw = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str());
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
    let meta_desc_sel = scraper_crate::Selector::parse(
        r#"meta[name="description"], meta[property="og:description"]"#,
    )
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
        _ => String::new(),
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

/// Protect scrape routes when the sidecar crosses a process or container
/// boundary. Loopback development remains credential-free, but non-loopback
/// deployments must configure this token before they start listening.
async fn require_internal_auth(request: Request, next: Next) -> Response {
    let Some(expected) = configured_auth_token() else {
        return next.run(request).await;
    };

    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| bearer_token_authorized(Some(value), &expected))
        .unwrap_or(false);

    if authorized {
        next.run(request).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer")],
            "scraper authentication required",
        )
            .into_response()
    }
}

fn configured_auth_token() -> Option<String> {
    std::env::var(SCRAPER_AUTH_TOKEN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bearer_token_authorized(header_value: Option<&str>, expected: &str) -> bool {
    header_value
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|provided| provided == expected)
        .unwrap_or(false)
}

fn non_loopback_without_auth(addr: &str, auth_token: Option<&str>) -> bool {
    let is_loopback = addr
        .parse::<std::net::SocketAddr>()
        .map(|socket| socket.ip().is_loopback())
        .unwrap_or(false);
    !is_loopback
        && auth_token
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
}

fn validate_bind_security(addr: &str) {
    assert!(
        !non_loopback_without_auth(addr, configured_auth_token().as_deref()),
        "social-scraper refuses non-loopback bind addresses without {SCRAPER_AUTH_TOKEN_ENV}"
    );
}

fn build_app() -> Router {
    let protected_routes = Router::new()
        .route("/scrape/social", post(scrape_social))
        .route("/scrape/competitor", post(scrape_competitor))
        .layer(middleware::from_fn(require_internal_auth));
    Router::new()
        .route("/health", get(health))
        .merge(protected_routes)
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

    let addr = std::env::var("AXIOM_SCRAPER_ADDR").unwrap_or_else(|_| "127.0.0.1:8102".to_string());
    validate_bind_security(&addr);
    info!("scraper listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, build_app()).await.unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn competitor_lookups_overlap_and_preserve_requested_order() {
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
        let results = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            super::collect_profile_results(
                vec!["instagram".into(), "tiktok".into(), "x".into()],
                move |platform| {
                    let barrier = barrier.clone();
                    async move {
                        barrier.wait().await;
                        super::CompetitorResult {
                            platform,
                            profile_url: String::new(),
                            followers: None,
                            posts: None,
                            engagement_rate: None,
                            error: Some("unavailable".into()),
                        }
                    }
                },
            ),
        )
        .await
        .expect("serial lookups deadlock at the barrier")
        .unwrap();
        assert_eq!(
            results
                .iter()
                .map(|r| r.platform.as_str())
                .collect::<Vec<_>>(),
            vec!["instagram", "tiktok", "x"]
        );
        assert!(results.iter().all(|r| r.error.is_some()));
    }
    #[test]
    fn unavailable_counts_serialize_as_null_not_zero() {
        let result = super::CompetitorResult {
            platform: "instagram".into(),
            profile_url: "https://instagram.com/example".into(),
            followers: Some(0),
            posts: None,
            engagement_rate: None,
            error: None,
        };
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["followers"], 0);
        assert!(json["posts"].is_null());
        assert!(json["engagement_rate"].is_null());
    }
    use super::*;
    use axum::{body::Body, http::Request as HttpRequest};
    use std::sync::OnceLock;
    use tower::ServiceExt;

    static AUTH_ENV_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

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
        assert_eq!(
            build_platform_url("instagram", "NASA"),
            "https://instagram.com/nasa"
        );
        assert_eq!(
            build_platform_url("tiktok", "NASA"),
            "https://tiktok.com/@nasa"
        );
        assert_eq!(build_platform_url("x", "NASA"), "https://x.com/nasa");
        assert_eq!(
            build_platform_url("fanvue", "Ava"),
            "https://fanvue.com/ava"
        );
        assert_eq!(build_platform_url("unsupported", "Ava"), "");
    }

    #[test]
    fn profile_host_allowlist_rejects_ssrf_targets() {
        assert!(is_allowed_profile_host(Some("instagram.com")));
        assert!(is_allowed_profile_host(Some("www.youtube.com")));
        assert!(!is_allowed_profile_host(Some("127.0.0.1")));
        assert!(!is_allowed_profile_host(Some("metadata.google.internal")));
        assert!(!is_allowed_profile_host(Some(
            "instagram.com.attacker.example"
        )));
    }

    #[test]
    fn non_loopback_scraper_bind_requires_authentication() {
        assert!(non_loopback_without_auth("0.0.0.0:8102", None));
        assert!(non_loopback_without_auth("scraper:8102", None));
        assert!(!non_loopback_without_auth("127.0.0.1:8102", None));
        assert!(!non_loopback_without_auth(
            "0.0.0.0:8102",
            Some("internal-token")
        ));
        assert!(non_loopback_without_auth("0.0.0.0:8102", Some("  ")));
    }

    #[test]
    fn scraper_requires_the_exact_healthy_model_and_open_kill_switch() {
        let status = serde_json::json!({"kill_switch":false,"models":[
            {"model_id":"one","healthy":true,"host_ip":"172.30.1.2"},
            {"model_id":"two","healthy":false,"host_ip":"172.30.2.2"}
        ]});
        assert_eq!(
            proxy_from_status(&status, "one").unwrap(),
            "http://172.30.1.2:8080"
        );
        assert!(proxy_from_status(&status, "two").is_err());
        assert!(proxy_from_status(&status, "absent").is_err());
        let mut halted = status.clone();
        halted["kill_switch"] = serde_json::json!(true);
        assert!(proxy_from_status(&halted, "one").is_err());
        halted["kill_switch"] = serde_json::Value::Null;
        assert!(proxy_from_status(&halted, "one").is_err());
        let mut invalid = status;
        invalid["models"][0]["host_ip"] = serde_json::json!("attacker.example/path");
        assert!(proxy_from_status(&invalid, "one").is_err());
    }

    #[tokio::test]
    async fn scraper_uses_bound_proxy_connect_without_direct_fallback() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let size = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]).to_string();
            socket
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
            request
        });
        let result = fetch_page("https://instagram.com/nasa", &proxy).await;
        assert!(result.is_err());
        let request = tokio::time::timeout(std::time::Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap();
        assert!(request.starts_with("CONNECT instagram.com:443 "));
    }

    #[test]
    fn scraper_auth_requires_the_exact_bearer_token() {
        assert!(bearer_token_authorized(
            Some("Bearer internal-token"),
            "internal-token"
        ));
        assert!(!bearer_token_authorized(None, "internal-token"));
        assert!(!bearer_token_authorized(
            Some("Bearer wrong-token"),
            "internal-token"
        ));
        assert!(!bearer_token_authorized(
            Some("Basic internal-token"),
            "internal-token"
        ));
    }

    #[tokio::test]
    async fn scrape_routes_require_auth_but_health_remains_public() {
        let _guard = AUTH_ENV_LOCK
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await;
        let previous = std::env::var_os(SCRAPER_AUTH_TOKEN_ENV);
        unsafe {
            std::env::set_var(SCRAPER_AUTH_TOKEN_ENV, "internal-token");
        }

        let body = serde_json::to_vec(&serde_json::json!({
            "platform": "instagram",
            "profile_url": "https://instagram.com/nasa"
        }))
        .unwrap();
        let request = |authorization: Option<&str>| {
            let mut builder = HttpRequest::builder()
                .method("POST")
                .uri("/scrape/social")
                .header("Content-Type", "application/json");
            if let Some(value) = authorization {
                builder = builder.header("Authorization", value);
            }
            builder.body(Body::from(body.clone())).unwrap()
        };

        let unauthorized_response = build_app().clone().oneshot(request(None)).await.unwrap();
        assert_eq!(unauthorized_response.status(), StatusCode::UNAUTHORIZED);
        let wrong_token_response = build_app()
            .clone()
            .oneshot(request(Some("Bearer wrong-token")))
            .await
            .unwrap();
        assert_eq!(wrong_token_response.status(), StatusCode::UNAUTHORIZED);
        let authorized_response = build_app()
            .clone()
            .oneshot(request(Some("Bearer internal-token")))
            .await
            .unwrap();
        assert_ne!(authorized_response.status(), StatusCode::UNAUTHORIZED);
        let health_response = build_app()
            .oneshot(
                HttpRequest::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(health_response.status(), StatusCode::UNAUTHORIZED);

        unsafe {
            match previous {
                Some(value) => std::env::set_var(SCRAPER_AUTH_TOKEN_ENV, value),
                None => std::env::remove_var(SCRAPER_AUTH_TOKEN_ENV),
            }
        }
    }

    #[test]
    fn competitor_platform_count_is_bounded() {
        assert!(validate_competitor_platforms(&[]).is_err());
        assert!(validate_competitor_platforms(&["instagram".to_string()]).is_ok());
        assert!(validate_competitor_platforms(&vec![
            "instagram".to_string();
            MAX_COMPETITOR_PLATFORMS + 1
        ])
        .is_err());
    }

    #[test]
    fn profile_body_limit_rejects_oversize_responses() {
        let mut body = Vec::new();
        append_limited_body(&mut body, &vec![b'a'; MAX_PROFILE_BODY_BYTES]).unwrap();
        assert_eq!(body.len(), MAX_PROFILE_BODY_BYTES);
        assert!(append_limited_body(&mut body, b"x").is_err());
    }
}
