//! Versioned, bounded frame sampling for short generated clips. The retained
//! content-addressed frames are audit artifacts, not an assertion of full-video
//! coverage. The worker must require human review even if all samples pass.
use super::{media_root, path_arg, resolve_input, MediaError, VideoProbeRequest};
use axum::Json;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, sync::Semaphore};

const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FRAMES: usize = 26;
static EXTRACTION: Semaphore = Semaphore::const_new(1);

#[derive(Serialize, Deserialize)]
pub(super) struct Frames {
    policy: String,
    source_sha256: String,
    duration_seconds: f64,
    frames: Vec<String>,
}

fn invalid(reason: &str) -> MediaError {
    MediaError::Ffmpeg(format!("video sampling: {reason}"))
}

fn dimensions_and_duration(probe: &serde_json::Value) -> Result<f64, MediaError> {
    let duration = probe
        .pointer("/format/duration")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse::<f64>().ok())
        .ok_or_else(|| invalid("missing duration"))?;
    let width = probe
        .pointer("/streams/0/width")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let height = probe
        .pointer("/streams/0/height")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if !duration.is_finite()
        || duration <= 0.0
        || duration > 12.0
        || width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || width * height > 16_000_000
    {
        return Err(invalid("unsupported duration or dimensions"));
    }
    Ok(duration)
}

/// Drain a bounded stdout and require success within the same deadline. Stderr
/// is discarded rather than retained (it may contain input-controlled text).
async fn run(mut command: Command, seconds: u64) -> Result<Vec<u8>, MediaError> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid("missing stdout"))?;
    let work = async {
        let mut output = Vec::new();
        (&mut stdout).take(16_385).read_to_end(&mut output).await?;
        if output.len() > 16_384 {
            return Err(invalid("excessive subprocess output"));
        }
        if !child.wait().await?.success() {
            return Err(invalid("decoder failed"));
        }
        Ok(output)
    };
    let result = tokio::time::timeout(Duration::from_secs(seconds), work).await;
    match result {
        Ok(Ok(output)) => Ok(output),
        result => {
            // Reap before the temporary input/output directory can be removed.
            let _ = child.kill().await;
            match result {
                Ok(Err(error)) => Err(error),
                _ => Err(invalid("decoder deadline exceeded")),
            }
        }
    }
}

pub(super) async fn extract(
    Json(req): Json<VideoProbeRequest>,
) -> Result<Json<Frames>, MediaError> {
    let _permit = EXTRACTION
        .try_acquire()
        .map_err(|_| invalid("extractor busy; retry later"))?;
    let input = resolve_input(&req.video_path)?;
    let root = media_root()?;
    let cache = root.join("tos-video-v1");
    std::fs::create_dir_all(&cache)?;
    if cache.canonicalize()? != cache {
        return Err(MediaError::InvalidPath);
    }
    let stage = tempfile::Builder::new()
        .prefix(".extract-")
        .tempdir_in(&cache)?;
    // Work only on a private bounded snapshot, never re-open the caller's path
    // in a decoder. MOV/MP4 external data references remain disabled by default.
    let mut source = tokio::fs::File::open(&input).await?;
    let before = source.metadata().await?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_BYTES {
        return Err(invalid("unsupported input size"));
    }
    let snapshot = stage.path().join("source.mp4");
    let mut target = tokio::fs::File::create(&snapshot).await?;
    let copied = tokio::io::copy(&mut (&mut source).take(MAX_BYTES + 1), &mut target).await?;
    drop(target);
    let after = source.metadata().await?;
    if copied != before.len()
        || after.len() != before.len()
        || after.modified()? != before.modified()?
    {
        return Err(invalid("input changed during snapshot"));
    }
    let mut file = tokio::fs::File::open(&snapshot).await?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let count = file.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    drop(file);
    let hash = format!("{:x}", digest.finalize());
    let destination = cache.join(&hash);
    if destination.exists() {
        let file = tokio::fs::File::open(destination.join("manifest.json")).await?;
        let mut bytes = Vec::new();
        file.take(16_385).read_to_end(&mut bytes).await?;
        if bytes.len() > 16_384 {
            return Err(invalid("invalid cached manifest"));
        }
        return Ok(Json(serde_json::from_slice(&bytes)?));
    }
    let mut probe = Command::new("ffprobe");
    probe.args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "mov",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        &path_arg(&snapshot),
    ]);
    let duration = dimensions_and_duration(&serde_json::from_slice(&run(probe, 10).await?)?)?;
    let mut ffmpeg = Command::new("ffmpeg");
    ffmpeg.args(["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file",
        "-threads", "1", "-f", "mov", "-i", &path_arg(&snapshot), "-map", "0:v:0",
        "-an", "-sn", "-dn", "-vf",
        "setpts=PTS-STARTPTS,fps=2:start_time=0:round=up,scale=512:512:force_original_aspect_ratio=decrease",
        "-threads", "1", "-frames:v", "26", "-t", "12.5", "-f", "image2",
        &path_arg(&stage.path().join("frame-%03d.png"))]);
    run(ffmpeg, 60).await?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(stage.path())? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("frame-") && name.ends_with(".png") {
            if !entry.file_type()?.is_file() || entry.metadata()?.len() > 2 * 1024 * 1024 {
                return Err(invalid("invalid output frame"));
            }
            names.push(name);
        }
    }
    names.sort();
    if names.is_empty()
        || names.len() >= MAX_FRAMES
        || names.len().abs_diff((duration * 2.0).ceil() as usize) > 1
    {
        return Err(invalid("incomplete frame coverage"));
    }
    let result = Frames {
        policy: "sampled-2fps-v1".into(),
        source_sha256: hash.clone(),
        duration_seconds: duration,
        frames: names
            .iter()
            .map(|name| format!("tos-video-v1/{hash}/{name}"))
            .collect(),
    };
    tokio::fs::remove_file(&snapshot).await?;
    tokio::fs::write(
        stage.path().join("manifest.json"),
        serde_json::to_vec(&result)?,
    )
    .await?;
    // Publish only a complete set; retries reuse it. Parent is service-owned.
    std::fs::rename(stage.path(), &destination)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires installed ffmpeg and ffprobe; run explicitly in runtime rehearsal"]
    async fn real_ffmpeg_short_clip_coverage_and_cache() {
        let root = media_root().unwrap();
        let fixture = tempfile::Builder::new()
            .prefix("video-frame-test-")
            .tempdir_in(&root)
            .unwrap();
        for seconds in [6, 10] {
            let input = fixture.path().join(format!("clip-{seconds}.mp4"));
            let mut command = Command::new("ffmpeg");
            command.args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=24",
                "-t",
                &seconds.to_string(),
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-pix_fmt",
                "yuv420p",
                &path_arg(&input),
            ]);
            run(command, 30).await.unwrap();
            let Json(result) = extract(Json(VideoProbeRequest {
                video_path: path_arg(&input),
            }))
            .await
            .unwrap();
            assert_eq!(result.frames.len(), seconds * 2);
            assert_eq!(result.duration_seconds, seconds as f64);
            for frame in &result.frames {
                let decoded = image::open(root.join(frame)).unwrap();
                assert_eq!(decoded.width(), 512);
                assert_eq!(decoded.height(), 288);
            }
            let Json(cached) = extract(Json(VideoProbeRequest {
                video_path: path_arg(&input),
            }))
            .await
            .unwrap();
            assert_eq!(result.frames, cached.frames);
            assert_eq!(result.source_sha256, cached.source_sha256);
        }
        let corrupt = fixture.path().join("invalid.mp4");
        tokio::fs::write(&corrupt, b"not a video").await.unwrap();
        assert!(extract(Json(VideoProbeRequest {
            video_path: path_arg(&corrupt)
        }))
        .await
        .is_err());
    }
    #[test]
    fn bounds_probe_before_decoding() {
        for (duration, width, height) in [
            ("NaN", 512, 512),
            ("0", 512, 512),
            ("13", 512, 512),
            ("6", 9000, 10),
            ("6", 8192, 8192),
            ("6", 0, 512),
        ] {
            assert!(
                dimensions_and_duration(&serde_json::json!({"format":{"duration":duration},
                "streams":[{"width":width,"height":height}]}))
                .is_err()
            );
        }
        assert_eq!(
            dimensions_and_duration(&serde_json::json!({"format":{"duration":"10"},
            "streams":[{"width":1920,"height":1080}]}))
            .unwrap(),
            10.0
        );
    }
}
