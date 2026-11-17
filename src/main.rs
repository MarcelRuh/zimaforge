use std::net::SocketAddr;

use tracing_subscriber::EnvFilter;
use zimaforge::{AppState, Config, app};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_env("ZIMAFORGE_LOG").unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .init();

    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("zimaforge {}", zimaforge::VERSION);
        return;
    }
    // Für den Docker-HEALTHCHECK im scratch-Image (dort gibt es kein curl).
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        std::process::exit(healthcheck().await);
    }

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(err) => {
            tracing::error!("{err}");
            std::process::exit(2);
        }
    };
    let state = AppState::new(config.clone());
    if let Err(err) = state.store.ensure_layout() {
        tracing::error!(dir = %config.data_dir.display(), error = %err, "Datenverzeichnis nicht beschreibbar");
        std::process::exit(1);
    }

    let listener = match tokio::net::TcpListener::bind(config.listen).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!(addr = %config.listen, error = %err, "Port nicht verfügbar");
            std::process::exit(1);
        }
    };
    tracing::info!(
        version = zimaforge::VERSION,
        listen = %config.listen,
        upstream = %config.upstream,
        data = %config.data_dir.display(),
        "ZimaForge gestartet"
    );

    axum::serve(listener, app(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown())
        .await
        .expect("Server-Fehler");
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { () = ctrl_c => {}, () = term => {} }
    tracing::info!("ZimaForge wird beendet");
}

/// Für den Docker-HEALTHCHECK: fragt `/_forge/api/health` an der Adresse ab, an der
/// ZimaForge lauscht (`ZIMAFORGE_BIND`; 0.0.0.0 bzw. :: über die Loopback-Adresse).
async fn healthcheck() -> i32 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Ok(config) = zimaforge::Config::from_env() else {
        return 1;
    };
    let mut target = config.listen;
    if target.ip().is_unspecified() {
        target.set_ip(match target.ip() {
            std::net::IpAddr::V4(_) => std::net::Ipv4Addr::LOCALHOST.into(),
            std::net::IpAddr::V6(_) => std::net::Ipv6Addr::LOCALHOST.into(),
        });
    }
    let check = async {
        let mut stream = tokio::net::TcpStream::connect(target).await.ok()?;
        let req = "GET /_forge/api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.ok()?;
        Some(buf.starts_with(b"HTTP/1.1 200"))
    };
    match tokio::time::timeout(std::time::Duration::from_secs(5), check).await {
        Ok(Some(true)) => 0,
        _ => 1,
    }
}
