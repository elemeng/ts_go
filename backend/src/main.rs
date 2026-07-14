use axum::Router;
use tower_http::cors::{Any, CorsLayer};
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

    // Configure CORS
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
        .layer(cors);

    let addr = "0.0.0.0:8000";
    tracing::info!("Starting server on {addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind address");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
