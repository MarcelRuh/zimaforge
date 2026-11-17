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
use axum::http::{Extensions, HeaderMap, HeaderValue, StatusCode, Version, header};
use tower_http::CompressionLevel;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{DefaultPredicate, Predicate};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

pub use config::Config;
pub use state::AppState;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Nur Textformate, die sich lohnen und nicht schon komprimiert sind.
fn compressible(_: StatusCode, _: Version, headers: &HeaderMap, _: &Extensions) -> bool {
    let Some(ct) = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let ct = ct.trim_start().to_ascii_lowercase();
    let essence = ct.split(';').next().unwrap_or("").trim();
    essence.starts_with("text/")
        || essence.ends_with("+json")
        || essence.ends_with("+xml")
        || matches!(
            essence,
            "application/javascript" | "application/json" | "application/xml" | "image/svg+xml" | "application/wasm"
        )
}

/// Vollständige Anwendung: eigene Routen, alles andere an ZimaOS.
pub fn app(state: AppState) -> Router {
    api::router()
        .fallback(proxy::forward)
        // Komprimiert nur Text (eigene Dateien, API, HTML mit Loader) in der schnellsten
        // Stufe. Downloads, Videos und Archive aus ZimaOS laufen unverändert durch –
        // sonst kostet das CPU auf dem NAS und Downloads verlieren Größe und Fortsetzen.
        .layer(
            CompressionLayer::new()
                .quality(CompressionLevel::Fastest)
                .compress_when(DefaultPredicate::new().and(compressible)),
        )
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("x-zimaforge-version"),
            HeaderValue::from_static(VERSION),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
