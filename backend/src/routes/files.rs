use std::path::Path;

use axum::{Json, extract::Query, http::StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct ListDirParams {
    path: Option<String>,
}

#[derive(Deserialize)]
pub struct LoadConfigParams {
    filename: String,
}

#[derive(Deserialize)]
pub struct DeleteConfigParams {
    filename: String,
}

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/user-home", axum::routing::get(get_user_home))
        .route("/list", axum::routing::get(list_directory))
        .route("/save-config", axum::routing::post(save_config))
        .route("/load-config", axum::routing::get(load_config))
        .route("/list-configs", axum::routing::get(list_configs))
        .route("/delete-config", axum::routing::delete(delete_config))
}

fn config_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/user".to_string());
    let dir = Path::new(&home).join(".ts_sv");
    std::fs::create_dir_all(&dir).ok();
    dir
}

async fn get_user_home() -> Json<Value> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/user".to_string());
    Json(json!({ "home": home }))
}

async fn list_directory(
    Query(params): Query<ListDirParams>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let path_str = params.path.unwrap_or_else(|| "/data".to_string());
    let dir_path = std::path::absolute(Path::new(&path_str))
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid path: {e}")))?;

    if !dir_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Directory not found: {path_str}"),
        ));
    }
    if !dir_path.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Not a directory: {path_str}"),
        ));
    }

    let mut entries = Vec::new();
    let mut read_dir = std::fs::read_dir(&dir_path)
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Permission denied: {e}")))?;

    while let Some(entry) = read_dir.next().transpose().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Read error: {e}"))
    })? {
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            "dir"
        } else {
            "file"
        };
        entries.push(json!({ "name": name, "type": file_type }));
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        let a_is_dir = a["type"] == "dir";
        let b_is_dir = b["type"] == "dir";
        if a_is_dir != b_is_dir {
            return if a_is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });

    Ok(Json(json!({
        "path": dir_path.to_string_lossy().to_string(),
        "entries": entries
    })))
}

async fn save_config(
    Json(config): Json<serde_json::Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let config_dir = config_dir();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let filename = format!("config_{timestamp}.json");
    let config_path = config_dir.join(&filename);

    let content = serde_json::to_string_pretty(&config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Serialization error: {e}"),
        )
    })?;

    std::fs::write(&config_path, &content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save config: {e}"),
        )
    })?;

    Ok(Json(json!({
        "success": true,
        "path": config_path.to_string_lossy().to_string(),
        "filename": filename
    })))
}

async fn load_config(
    Query(params): Query<LoadConfigParams>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let config_path = config_dir().join(&params.filename);

    if !config_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Config not found: {}", params.filename),
        ));
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read config: {e}"),
        )
    })?;

    let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse config: {e}"),
        )
    })?;

    Ok(Json(config))
}

async fn list_configs() -> Result<Json<Value>, (StatusCode, String)> {
    let config_dir = config_dir();
    let mut configs: Vec<String> = Vec::new();

    if let Ok(read_dir) = std::fs::read_dir(&config_dir) {
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("config_") && name.ends_with(".json") {
                configs.push(name);
            }
        }
    }

    configs.sort_by(|a, b| b.cmp(a)); // Reverse sort (newest first)

    Ok(Json(json!({ "configs": configs })))
}

async fn delete_config(
    Query(params): Query<DeleteConfigParams>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let config_path = config_dir().join(&params.filename);

    if !config_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Config not found: {}", params.filename),
        ));
    }

    std::fs::remove_file(&config_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete config: {e}"),
        )
    })?;

    Ok(Json(json!({
        "success": true,
        "message": format!("Deleted {}", params.filename)
    })))
}
