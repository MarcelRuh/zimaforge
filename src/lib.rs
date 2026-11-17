//! ZimaForge – Mod-Framework für das ZimaOS-Dashboard.
//!
//! Ein einzelnes Rust-Binary sitzt als Reverse-Proxy vor dem ZimaOS-Gateway,
//! schleust einen kleinen Loader in das Dashboard ein und stellt eine API für
//! Mods, Store, Einstellungen und Systemwerte bereit.

pub mod api;
pub mod auth;
pub mod boot;
pub mod config;
pub mod inject;
pub mod metrics;
pub mod mods;
pub mod proxy;
pub mod state;
pub mod sysinfo;

use axum::Router;
use axum::http::{HeaderValue, header};
use tower_http::CompressionLevel;
use tower_http::compression::CompressionLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

pub use config::Config;
pub use state::AppState;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Vollständige Anwendung: eigene Routen, alles andere an ZimaOS.
pub fn app(state: AppState) -> Router {
    api::router()
        .fallback(proxy::forward)
        // Komprimiert, was noch nicht komprimiert ist (eigene Dateien, API, HTML mit
        // Loader). Schnellste Stufe – wenig CPU-Last auf dem Server. Bilder, SSE
        // und bereits komprimierte Antworten lässt die Standardregel aus.
        .layer(CompressionLayer::new().quality(CompressionLevel::Fastest))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("x-zimaforge-version"),
            HeaderValue::from_static(VERSION),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
