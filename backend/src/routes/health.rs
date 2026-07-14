use axum::Json;
use serde_json::{json, Value};

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/", axum::routing::get(root))
        .route("/health", axum::routing::get(health_check))
}

async fn root() -> Json<Value> {
    Json(json!({
        "message": "TS-SV Backend API",
        "version": "0.1.0",
        "docs": "/docs"
    }))
}

async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
