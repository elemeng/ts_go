use std::path::PathBuf;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

mod cache;
mod image;
mod matcher;
mod mdoc;
mod models;
mod routes;
mod state;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Determine frontend directory: check binary parent, then cwd
    let frontend_dir = std::env::var("FRONTEND_DIR").unwrap_or_else(|_| {
        // Default: look for "frontend" next to the binary or in cwd
        let exe = std::env::current_exe().ok();
        if let Some(parent) = exe.and_then(|p| p.parent().map(|p| p.join("frontend"))) {
            if parent.exists() {
                return parent.to_string_lossy().to_string();
            }
        }
        "frontend".to_string()
    });

    let frontend_path: PathBuf = frontend_dir.into();
    let frontend_path_str = frontend_path.to_string_lossy().to_string();

    if frontend_path.exists() {
        tracing::info!("Serving frontend from: {}", frontend_path_str);
    } else {
        tracing::warn!(
            "Frontend directory not found at '{}' — API-only mode",
            frontend_path_str
        );
    }

    // Configure CORS (still needed for dev mode with separate ports)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build the application router with all route groups
    let app = Router::new()
        // Health endpoints
        .nest("/", routes::health::router())
        // API endpoints
        .nest("/api/mdoc", routes::mdoc::router())
        .nest("/api/preview", routes::preview::router())
        .nest("/api/project", routes::project::router())
        .nest("/api/files", routes::files::router())
        // Apply CORS
        .layer(cors)
        // Serve static frontend files for everything else
        .fallback_service(ServeDir::new(&frontend_path).append_index_html_on_directories(true));

    let addr = "0.0.0.0:8000";
    tracing::info!("Starting server on {addr}");
    tracing::info!("  → API:  http://localhost:{addr}/api/");
    tracing::info!("  → App:  http://localhost:{addr}/");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind address");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
