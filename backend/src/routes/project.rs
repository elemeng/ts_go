use std::path::Path;

use axum::Json;
use serde_json::{Value, json};

use crate::matcher::cut_match::ImageMatcher;
use crate::mdoc::parser::parse_mdoc_file;
use crate::models::types::{ScanConfig, TiltSeries};
use crate::state::project_state::PROJECT_STATE;

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/scan", axum::routing::post(scan_project))
        .route("/status", axum::routing::get(get_project_status))
        .route("/save_all", axum::routing::post(save_all))
}

async fn scan_project(Json(config): Json<ScanConfig>) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    tracing::info!("[project] Scanning project: {:?}", config);

    PROJECT_STATE.set_config(config.clone()).await;

    let mut matcher = ImageMatcher::new(
        &config.image_dir,
        config.image_prefix_cut as usize,
        config.image_suffix_cut as usize,
    );
    matcher.build_cache();

    let mdoc_dir = Path::new(&config.mdoc_dir);
    if !mdoc_dir.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("mdoc directory not found: {}", config.mdoc_dir),
        ));
    }

    let mut tilt_series: Vec<TiltSeries> = Vec::new();

    let walker = walkdir::WalkDir::new(mdoc_dir).max_depth(10);
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("mdoc") {
                match parse_mdoc_file(&path.to_string_lossy(), &matcher) {
                    Ok(ts) => {
                        PROJECT_STATE.add_tilt_series(ts.clone()).await;
                        tilt_series.push(ts);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse {}: {}", path.display(), e);
                    }
                }
            }
        }
    }

    Ok(Json(json!({
        "tiltSeries": tilt_series,
        "total": tilt_series.len()
    })))
}

async fn get_project_status() -> Json<Value> {
    let series = PROJECT_STATE.list_tilt_series().await;
    Json(json!({
        "totalSeries": series.len(),
        "hasConfig": true,
        "unsavedCount": 0
    }))
}

async fn save_all() -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    let series = PROJECT_STATE.list_tilt_series().await;
    let mut saved_count = 0;

    for _ts in &series {
        // Selections are managed by frontend; this endpoint just confirms state
        saved_count += 1;
    }

    Ok(Json(json!({
        "success": true,
        "savedCount": saved_count,
        "failedCount": 0,
        "errors": []
    })))
}
