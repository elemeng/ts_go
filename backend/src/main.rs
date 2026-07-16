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
        let exe = std::env::current_exe().ok();
        if let Some(parent) = exe.and_then(|p| p.parent().map(|p| p.join("frontend")))
            && parent.exists()
        {
            return parent.to_string_lossy().to_string();
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
    let cors_origin: tower_http::cors::AllowOrigin = match std::env::var("CORS_ORIGIN") {
        Ok(origin) if !origin.is_empty() => {
            match origin.parse::<axum::http::HeaderValue>() {
                Ok(hv) => hv.into(),
                Err(e) => {
                    tracing::warn!("Invalid CORS_ORIGIN value '{origin}': {e}, falling back to AllowOrigin::any()");
                    Any.into()
                }
            }
        }
        _ => Any.into(),
    };
    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build the application router with all route groups
    let app = Router::new()
        // API endpoints
        .nest("/api/mdoc", routes::mdoc::router())
        .nest("/api/preview", routes::preview::router())
        .nest("/api/files", routes::files::router())
        // Root-level routes (health check)
        .merge(routes::health::router())
        // Apply CORS
        .layer(cors)
        // Serve static frontend files for everything else
        .fallback_service(ServeDir::new(&frontend_path).append_index_html_on_directories(true));

    // Determine port — env var, or default 8088
    let default_port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8088);

    // Try ports in range, with friendly messages
    let max_attempts: u16 = std::env::var("PORT_MAX_TRIES")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(10);

    let mut port = default_port;
    let mut bound = None;

    for attempt in 0..max_attempts {
        let addr = format!("0.0.0.0:{port}");
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => {
                tracing::info!("✅ Server started on port {port}");
                tracing::info!("   → App:  http://localhost:{port}");
                tracing::info!("   → API:  http://localhost:{port}/api/");
                // Write the port to a temp file so run.sh can read it
                if let Ok(path) = std::env::var("PORT_FILE") {
                    let _ = std::fs::write(&path, port.to_string());
                }
                // Print to stdout for the launcher script to parse
                println!("__PORT__={port}");
                bound = Some((listener, port));
                break;
            }
            Err(e) => {
                let err_msg = e.to_string();
                let kind_str = match e.kind() {
                    std::io::ErrorKind::AddrInUse => "bind: Address already in use",
                    std::io::ErrorKind::PermissionDenied => "bind: Permission denied",
                    _ => &err_msg,
                };
                eprintln!(
                    "⚠  Port {port} is already in use by another process ({kind_str})."
                );

                if attempt < max_attempts - 1 {
                    eprintln!("   → Retrying with port {}...", port + 1);
                }
                port += 1;
            }
        }
    }

    let (listener, _final_port) = bound.unwrap_or_else(|| {
        eprintln!(
            "\n❌ Could not find a free port in range {}-{}.",
            default_port,
            default_port + max_attempts - 1
        );
        eprintln!("   Possible fixes:");
        eprintln!("     • Set PORT=xxxx to pick a specific port");
        eprintln!("     • Check firewall rules: firewall-cmd --list-ports");
        eprintln!("     • Check what is using the port: ss -tlnp | grep {default_port}");
        std::process::exit(1);
    });

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
