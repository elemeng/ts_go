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
use serde_json::{Value, json};
use tokio::sync::oneshot;

use crate::cache::lru::PngCache;
use crate::image::contrast::autocontrast_minmax;
use crate::image::encoder::{encode_png, save_png};
use crate::image::reader::read_image;
use crate::state::project_state::PROJECT_STATE;

/// Global PNG cache
static PNG_CACHE: LazyLock<Mutex<PngCache>> = LazyLock::new(|| Mutex::new(PngCache::new(2048)));

/// In-flight task deduplication
static INFLIGHT: LazyLock<Mutex<HashMap<String, oneshot::Receiver<Vec<u8>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
pub struct PreviewParams {
    bin: Option<i32>,
    quality: Option<i32>,
}

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/{ts_id}/{frame_id}", axum::routing::get(get_preview))
        .route("/capabilities", axum::routing::get(get_capabilities))
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

    // Check memory cache
    {
        let mut cache = PNG_CACHE.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Cache lock error: {e}"),
            )
        })?;
        if let Some(data) = cache.get(&ts_id, frame_id, bin, quality) {
            return Ok(build_png_response(data.to_vec()));
        }
    }

    // Check disk cache
    let config = PROJECT_STATE.config.read().await;
    if let Some(ref cfg) = *config {
        let png_path = Path::new(&cfg.png_dir)
            .join(&ts_id)
            .join(format!("bin{bin}"))
            .join(format!("frame_{frame_id:04}_q{quality}.png"));

        if png_path.exists() {
            if let Ok(data) = std::fs::read(&png_path) {
                let mut cache = PNG_CACHE.lock().map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Cache lock error: {e}"),
                    )
                })?;
                cache.put(&ts_id, frame_id, bin, quality, data.clone());
                return Ok(build_png_response(data));
            }
        }
    }
    drop(config);

    // Check in-flight tasks
    let existing_rx = {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Lock error: {e}"),
            )
        })?;
        inflight.remove(&task_key)
    };
    if let Some(rx) = existing_rx {
        // Wait for the existing task (MutexGuard is dropped before await)
        let data = rx.await.map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Task cancelled".to_string(),
            )
        })?;
        return Ok(build_png_response(data));
    }

    // Create new task
    let (tx, rx) = oneshot::channel();
    {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Lock error: {e}"),
            )
        })?;
        inflight.insert(task_key.clone(), rx);
    }

    // Get tilt series and frame info (async, outside spawn_blocking)
    let ts = PROJECT_STATE.get_tilt_series(&ts_id).await
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Tilt series not found: {ts_id}")))?;

    let frame = ts.frames.iter().find(|f| f.z_index == frame_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Frame not found: {frame_id}")))?;

    let mrc_path = frame.mrc_path.clone();
    let png_dir = PROJECT_STATE.config.read().await.clone()
        .map(|cfg| cfg.png_dir.clone());

    // Generate PNG (blocking I/O: read MRC + process image)
    let result = tokio::task::spawn_blocking(move || {
        generate_png(&mrc_path, ts_id, frame_id, bin, quality, png_dir.as_deref())
    })
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Task error: {e}"),
            )
        })?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Send result to waiters
    let _ = tx.send(result.clone());

    // Cleanup inflight
    {
        let mut inflight = INFLIGHT.lock().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Lock error: {e}"),
            )
        })?;
        inflight.remove(&task_key);
    }

    Ok(build_png_response(result))
}

/// Build a PNG response with the correct content type header.
fn build_png_response(data: Vec<u8>) -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "image/png")], data)
}

fn generate_png(
    mrc_path: &str,
    ts_id: String,
    frame_id: i32,
    bin: i32,
    quality: i32,
    png_dir: Option<&str>,
) -> Result<Vec<u8>, String> {
    // Read image as f32
    let img_f32 = read_image(mrc_path)
        .ok_or_else(|| format!("Failed to read image: {mrc_path}"))?;

    // Convert to f64 for processing
    let img_f64 = img_f32.mapv(|v| v as f64);

    // Bin if needed
    let binned = if bin > 1 {
        crate::image::binning::bin_ndarray(&img_f64, bin as usize)
    } else {
        img_f64
    };

    // Apply autocontrast
    let contrasted = autocontrast_minmax(
        &binned, 0.1,   // lower_percentile
        99.9,  // upper_percentile
        0.75,  // gamma
        false, // bg_subtract
    );

    // Save to disk (if png_dir was provided)
    if let Some(dir) = png_dir {
        let png_path = Path::new(dir)
            .join(&ts_id)
            .join(format!("bin{bin}"))
            .join(format!("frame_{frame_id:04}_q{quality}.png"));
        save_png(&contrasted, &png_path.to_string_lossy());
    }

    // Encode to PNG bytes
    let data = encode_png(&contrasted, quality as u8);

    // Cache in memory
    let mut cache = PNG_CACHE
        .lock()
        .map_err(|e| format!("Cache lock error: {e}"))?;
    cache.put(&ts_id, frame_id, bin, quality, data.clone());

    Ok(data)
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
