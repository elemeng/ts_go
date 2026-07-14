use std::path::Path;

use axum::{
    extract::Path as AxumPath,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::mdoc::parser::parse_mdoc_file;
use crate::mdoc::writer::write_mdoc_with_selections;
use crate::matcher::cut_match::ImageMatcher;
use crate::models::types::{
    BatchSaveRequest, BatchSaveResponse, BackupDeleteResponse, DeleteAllRequest,
    SaveAllRequest, SaveAllResponse, ScanConfig, TiltSeries,
};
use crate::state::project_state::PROJECT_STATE;

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/scan", axum::routing::post(scan_project))
        .route("/list", axum::routing::get(list_tilt_series))
        .route("/{ts_id}", axum::routing::get(get_tilt_series))
        .route("/save-all", axum::routing::post(save_all))
        .route("/delete-all", axum::routing::post(delete_all))
        .route("/batch-save", axum::routing::post(batch_save))
        .route("/backup-delete", axum::routing::post(backup_delete))
}

async fn scan_project(Json(config): Json<ScanConfig>) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    tracing::info!("Scanning project: {:?}", config);

    PROJECT_STATE.set_config(config.clone()).await;

    // Build image matcher cache
    let mut matcher = ImageMatcher::new(
        &config.image_dir,
        config.image_prefix_cut as usize,
        config.image_suffix_cut as usize,
    );
    matcher.build_cache();

    // Scan for mdoc files
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

    tracing::info!("Found {} tilt series", tilt_series.len());

    Ok(Json(json!({
        "tilt_series": tilt_series,
        "total": tilt_series.len()
    })))
}

async fn list_tilt_series() -> Json<Vec<TiltSeries>> {
    let series = PROJECT_STATE.list_tilt_series().await;
    Json(series)
}

async fn get_tilt_series(AxumPath(ts_id): AxumPath<String>) -> Result<Json<TiltSeries>, (axum::http::StatusCode, String)> {
    match PROJECT_STATE.get_tilt_series(&ts_id).await {
        Some(ts) => Ok(Json(ts)),
        None => Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("Tilt series not found: {ts_id}"),
        )),
    }
}

async fn save_all(Json(request): Json<SaveAllRequest>) -> Json<SaveAllResponse> {
    let mut saved = Vec::new();
    let mut failed = Vec::new();

    if request.selections.is_empty() {
        return Json(SaveAllResponse {
            success: true,
            message: "No changes to save".to_string(),
            saved: vec![],
            failed: vec![],
            deleted: vec![],
        });
    }

    for (mdoc_path, selections) in &request.selections {
        match write_mdoc_with_selections(mdoc_path, selections) {
            Ok(_) => {
                PROJECT_STATE.update_tilt_series_frames(mdoc_path, selections).await;
                saved.push(mdoc_path.clone());
            }
            Err(e) => {
                tracing::error!("Failed to save {}: {}", mdoc_path, e);
                failed.push(format!("{mdoc_path}: {e}"));
            }
        }
    }

    let success = failed.is_empty();
    let message = if success {
        format!("Saved {} mdoc files", saved.len())
    } else {
        format!("Saved {} mdoc files, {} failed", saved.len(), failed.len())
    };

    Json(SaveAllResponse {
        success,
        saved,
        failed,
        deleted: vec![],
        message,
    })
}

async fn delete_all(Json(request): Json<DeleteAllRequest>) -> Json<Value> {
    let mut deleted = Vec::new();
    let mut failed = Vec::new();

    for mdoc_path_str in &request.mdoc_paths {
        let mdoc_path = Path::new(mdoc_path_str);
        if !mdoc_path.exists() {
            failed.push(format!("{mdoc_path_str}: file not found"));
            continue;
        }

        // Create backup
        let backup = mdoc_path.with_extension("mdoc.bak");
        match std::fs::copy(mdoc_path, &backup) {
            Ok(_) => {
                // Delete original
                match std::fs::remove_file(mdoc_path) {
                    Ok(_) => {
                        PROJECT_STATE.remove_tilt_series_by_mdoc_path(mdoc_path_str).await;
                        deleted.push(mdoc_path_str.clone());
                    }
                    Err(e) => {
                        failed.push(format!("{mdoc_path_str}: {e}"));
                    }
                }
            }
            Err(e) => {
                failed.push(format!("{mdoc_path_str}: backup failed - {e}"));
            }
        }
    }

    Json(json!({
        "success": failed.is_empty(),
        "deleted": deleted,
        "failed": failed,
        "message": format!("Deleted {} mdoc files, {} failed", deleted.len(), failed.len())
    }))
}

async fn batch_save(Json(request): Json<BatchSaveRequest>) -> Result<Json<BatchSaveResponse>, (axum::http::StatusCode, String)> {
    let ts = PROJECT_STATE
        .list_tilt_series()
        .await
        .into_iter()
        .find(|t| t.mdoc_path == request.mdoc_path);

    let ts = ts.ok_or_else(|| {
        (
            axum::http::StatusCode::NOT_FOUND,
            format!("Tilt series not found: {}", request.mdoc_path),
        )
    })?;

    match write_mdoc_with_selections(&request.mdoc_path, &request.selections) {
        Ok(backup_path) => {
            PROJECT_STATE
                .update_tilt_series_frames(&request.mdoc_path, &request.selections)
                .await;

            let updated_ts = PROJECT_STATE.get_tilt_series(&ts.id).await;

            Ok(Json(BatchSaveResponse {
                success: true,
                message: format!("Saved {} frame selections", request.selections.len()),
                backup_path: Some(backup_path),
                updated_tilt_series: updated_ts,
            }))
        }
        Err(e) => Err((
            axum::http::StatusCode::CONFLICT,
            format!("Save failed: {e}"),
        )),
    }
}

async fn backup_delete(Json(request): Json<BackupDeleteRequest>) -> Result<Json<BackupDeleteResponse>, (axum::http::StatusCode, String)> {
    let mdoc_path = Path::new(&request.mdoc_path);
    if !mdoc_path.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            format!("mdoc file not found: {}", request.mdoc_path),
        ));
    }

    let backup = mdoc_path.with_extension("mdoc.bak");
    std::fs::copy(mdoc_path, &backup).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Backup failed: {e}"),
        )
    })?;

    std::fs::remove_file(mdoc_path).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Delete failed: {e}"),
        )
    })?;

    PROJECT_STATE.remove_tilt_series_by_mdoc_path(&request.mdoc_path).await;

    Ok(Json(BackupDeleteResponse {
        success: true,
        message: format!("Backed up and deleted {}", request.mdoc_path),
        backup_path: Some(backup.to_string_lossy().to_string()),
    }))
}

#[derive(Deserialize)]
struct BackupDeleteRequest {
    mdoc_path: String,
}
