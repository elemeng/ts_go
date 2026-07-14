use axum::Json;
use serde_json::{json, Value};

pub fn router() -> axum::Router {
    axum::Router::new()
        .route("/health", axum::routing::get(health_check))
}

async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
