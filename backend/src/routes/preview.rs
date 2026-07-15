use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use axum::{
    extract::Path as AxumPath,
    extract::Query,
    http::{StatusCode, header},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::oneshot;

use crate::cache::lru::PngCache;
use crate::image::contrast::autocontrast_minmax;
use crate::image::encoder::{encode_png, save_png};
use crate::image::reader::read_image;
use crate::state::project_state::PROJECT_STATE;

type InFlightTask = oneshot::Receiver<(Vec<u8>, Option<u64>)>;

/// Global PNG cache
static PNG_CACHE: LazyLock<Mutex<PngCache>> = LazyLock::new(|| Mutex::new(PngCache::new(2048)));

/// In-flight task deduplication
static INFLIGHT: LazyLock<Mutex<HashMap<String, InFlightTask>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
pub struct PreviewParams {
    bin: Option<i32>,
    quality: Option<i32>,
}

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/{ts_id}/{frame_id}", axum::routing::get(get_preview))
        .route("/{ts_id}/mtimes", axum::routing::get(get_mtimes))
        .route("/capabilities", axum::routing::get(get_capabilities))
}

/// Build the expected disk-cache path for a frame.
fn png_disk_path(
    png_dir: &str,
    ts_id: &str,
    frame_id: i32,
    bin: i32,
    quality: i32,
) -> std::path::PathBuf {
    Path::new(png_dir)
        .join(ts_id)
        .join(format!("bin{bin}"))
        .join(format!("frame_{frame_id:04}_q{quality}.png"))
}

/// Read the mtime of a file on disk, if it exists.
fn file_mtime(p: &std::path::Path) -> Option<u64> {
    std::fs::metadata(p).ok().and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

async fn get_preview(
    AxumPath((ts_id, frame_id)): AxumPath<(String, i32)>,
    Query(params): Query<PreviewParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bin = params.bin.unwrap_or(8);
    let quality = params.quality.unwrap_or(90);

    // Validate params
    if ![1, 2, 4, 8].contains(&bin) {
        return Err((
            StatusCode::BAD_REQUEST,
            "bin must be 1, 2, 4, or 8".to_string(),
        ));
    }
    if !(1..=100).contains(&quality) {
        return Err((
            StatusCode::BAD_REQUEST,
            "quality must be between 1 and 100".to_string(),
        ));
    }

    let task_key = format!("{ts_id}_{frame_id}_bin{bin}_q{quality}");

    // Helper: read the mtime of a file on disk
    let file_mtime_local = |p: &std::path::Path| -> Option<u64> {
        std::fs::metadata(p).ok().and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
    };

    // Check memory cache
    {
        let mut cache = PNG_CACHE.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("cache lock error: {e}"),
            )
        })?;
        if let Some(entry) = cache.get(&ts_id, frame_id, bin, quality) {
            return Ok(build_png_response(entry.data.clone(), entry.mtime));
        }
    }

    // Check disk cache
    let config = PROJECT_STATE.config.read().await;
    if let Some(ref cfg) = *config {
        let png_path = png_disk_path(&cfg.png_dir,
            &ts_id,
            frame_id,
            bin,
            quality,
        );

        if png_path.exists() && let Ok(data) = std::fs::read(&png_path) {
            let mtime = file_mtime_local(&png_path);
            let mut cache = PNG_CACHE.lock().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("cache lock error: {e}"),
                )
            })?;
            cache.put(&ts_id, frame_id, bin, quality, data.clone(), mtime);
            return Ok(build_png_response(data, mtime));
        }
    }
    drop(config);

    // Check in-flight tasks
    let existing_rx = {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("lock error: {e}"),
            )
        })?;
        inflight.remove(&task_key)
    };
    if let Some(rx) = existing_rx {
        // Wait for the existing task (MutexGuard is dropped before await)
        let (data, mtime) = rx.await.map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "task cancelled".to_string(),
            )
        })?;
        return Ok(build_png_response(data, mtime));
    }

    // Create new task
    let (tx, rx) = oneshot::channel();
    {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("lock error: {e}"),
            )
        })?;
        inflight.insert(task_key.clone(), rx);
    }

    // Process in a block that always cleans up the inflight entry,
    // even if an error occurs (prevents stale entries).
    let result = {
        // Get tilt series and frame info (async, outside spawn_blocking)
        let ts = PROJECT_STATE.get_tilt_series(&ts_id).await
            .ok_or_else(|| (StatusCode::NOT_FOUND, format!("tilt series not found: {ts_id}")))?;

        let frame = ts.frames.iter().find(|f| f.z_index == frame_id)
            .ok_or_else(|| (StatusCode::NOT_FOUND, format!("frame not found: {frame_id}")))?;

        let mrc_path = frame.mrc_path.clone();
        let png_dir = PROJECT_STATE.config.read().await.clone()
            .map(|cfg| cfg.png_dir.clone());
        let ts_id_clone = ts_id.clone();

        // Generate PNG (blocking I/O: read MRC + process image)
        tokio::task::spawn_blocking(move || {
            generate_png(&mrc_path, ts_id_clone, frame_id, bin, quality, png_dir.as_deref())
        })
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("task error: {e}"),
                )
            })?
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
    };

    // Always clean up inflight entry (runs after both success and error)
    {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("lock error: {e}"),
            )
        })?;
        inflight.remove(&task_key);
    }

    let (data, disk_mtime) = result?;

    // Send result to waiters (harmless if receiver was already dropped)
    let _ = tx.send((data.clone(), disk_mtime));

    Ok(build_png_response(data, disk_mtime))
}

/// Response shape for the batch-mtimes endpoint.
#[derive(Serialize)]
struct MtimesResponse {
    mtimes: HashMap<i32, u64>,
}

/// Return the disk mtime for every frame of a tilt series without generating
/// or transmitting any PNG data.  The frontend uses this to evict stale cached
/// PNGs after scan / page refresh / cache-all.
async fn get_mtimes(
    AxumPath(ts_id): AxumPath<String>,
    Query(params): Query<PreviewParams>,
) -> Result<Json<MtimesResponse>, (StatusCode, String)> {
    let bin = params.bin.unwrap_or(8);
    let quality = params.quality.unwrap_or(90);

    if ![1, 2, 4, 8].contains(&bin) {
        return Err((
            StatusCode::BAD_REQUEST,
            "bin must be 1, 2, 4, or 8".to_string(),
        ));
    }
    if !(1..=100).contains(&quality) {
        return Err((
            StatusCode::BAD_REQUEST,
            "quality must be between 1 and 100".to_string(),
        ));
    }

    let config = PROJECT_STATE.config.read().await;
    let Some(ref cfg) = *config else {
        return Ok(Json(MtimesResponse { mtimes: HashMap::new() }));
    };
    let png_dir = cfg.png_dir.clone();
    drop(config);

    let ts = PROJECT_STATE.get_tilt_series(&ts_id).await
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("tilt series not found: {ts_id}")))?;

    let mut mtimes = HashMap::with_capacity(ts.frames.len());
    for frame in &ts.frames {
        let png_path = png_disk_path(&png_dir,
            &ts_id,
            frame.z_index,
            bin,
            quality,
        );
        if let Some(mtime) = file_mtime(&png_path) {
            mtimes.insert(frame.z_index, mtime);
        }
    }

    Ok(Json(MtimesResponse { mtimes }))
}

/// Build a PNG response with the correct content type and the PNG disk file's mtime.
/// The frontend uses mtime to skip re-downloading unchanged PNGs during "Cache All".
fn build_png_response(data: Vec<u8>, disk_mtime: Option<u64>) -> impl IntoResponse {
    use axum::http::HeaderValue;
    use axum::response::IntoResponse as _;

    let ctype_hdr = HeaderValue::from_static("image/png");
    let mtime_str = disk_mtime.map(|m| m.to_string());
    let mtime_hdr = mtime_str.as_ref().and_then(|s| HeaderValue::from_str(s).ok());

    match mtime_hdr {
        Some(hdr) => (
            [
                (header::CONTENT_TYPE, ctype_hdr),
                (header::HeaderName::from_static("x-png-mtime"), hdr),
            ],
            data,
        ).into_response(),
        None => (
            [(header::CONTENT_TYPE, ctype_hdr)],
            data,
        ).into_response(),
    }
}

fn generate_png(
    mrc_path: &str,
    ts_id: String,
    frame_id: i32,
    bin: i32,
    quality: i32,
    png_dir: Option<&str>,
) -> Result<(Vec<u8>, Option<u64>), String> {
    // Read image as f32
    let img_f32 = read_image(mrc_path)
        .ok_or_else(|| format!("failed to read image: {mrc_path}"))?;

    // Bin if needed
    let binned = if bin > 1 {
        crate::image::binning::bin_ndarray(&img_f32, bin as usize)
    } else {
        img_f32
    };

    // Apply autocontrast
    let contrasted = autocontrast_minmax(
        &binned, 0.1,   // lower_percentile
        99.9,  // upper_percentile
        0.75,  // gamma
        false, // bg_subtract
    );

    // Save to disk and stat for mtime
    let disk_mtime = png_dir.and_then(|dir| {
        let png_path = png_disk_path(dir, &ts_id, frame_id, bin, quality);
        if save_png(&contrasted, &png_path.to_string_lossy()).is_ok() {
            file_mtime(&png_path)
        } else {
            None
        }
    });

    // Encode to PNG bytes
    let data = encode_png(&contrasted, quality as u8)?;

    // Cache in memory
    let mut cache = PNG_CACHE
        .lock()
        .map_err(|e| format!("Cache lock error: {e}"))?;
    cache.put(&ts_id, frame_id, bin, quality, data.clone(), disk_mtime);

    Ok((data, disk_mtime))
}

async fn get_capabilities() -> Json<Value> {
    Json(json!({
        "supported_bins": [1, 2, 4, 8],
        "default_bin": 8,
        "quality_range": [1, 100],
        "default_quality": 90,
        "format": "PNG"
    }))
}
