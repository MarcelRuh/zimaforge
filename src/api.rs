//! ZimaForge-eigene Routen: API unter `/_forge/api`, Laufzeit unter
//! `/_forge/runtime`, Mod-Dateien unter `/_forge/mods` (und `/mod` für
//! ZimaMOD/CasaMOD-Kompatibilität).

use axum::Json;
use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::auth::AuthError;
use crate::mods::{self, ModError};
use crate::state::AppState;

#[derive(RustEmbed)]
#[folder = "runtime/"]
struct Runtime;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut resp = (self.0, Json(json!({ "error": self.1 }))).into_response();
        resp.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        resp
    }
}

impl From<ModError> for ApiError {
    fn from(err: ModError) -> Self {
        let status = match &err {
            ModError::InvalidId | ModError::InvalidConfig(_) => StatusCode::BAD_REQUEST,
            ModError::NotFound => StatusCode::NOT_FOUND,
            ModError::InvalidManifest(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ModError::Io(e) => {
                tracing::error!(error = %e, "Dateifehler");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        Self(status, err.to_string())
    }
}

impl From<AuthError> for ApiError {
    fn from(err: AuthError) -> Self {
        Self(err.status(), err.to_string())
    }
}

type ApiResult<T = Response> = Result<T, ApiError>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, ModError> + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(ApiError::from)
}

fn no_store(value: serde_json::Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}

pub fn router() -> Router<AppState> {
    let api = Router::new()
        .route("/health", get(health))
        .route("/mods", get(list_active))
        .route("/mods/{id}/enabled", put(set_enabled))
        .route("/store", get(store))
        .route("/store/{id}", post(install).delete(uninstall))
        .route("/config", get(read_all_config))
        .route("/config/{id}", get(read_config).put(write_config))
        .route("/metrics", get(metrics))
        .route("/system", get(system))
        .route("/session", get(session))
        .layer(DefaultBodyLimit::max(mods::MAX_CONFIG_BYTES));

    Router::new()
        .nest("/_forge/api", api)
        .route("/_forge/runtime/{*path}", get(runtime_asset))
        .route("/_forge/mods/{id}/{*path}", get(mod_asset))
        .route("/mod/{id}/{*path}", get(mod_asset))
        .route("/_forge/catalog/{id}/{*path}", get(catalog_asset))
}

async fn health(State(state): State<AppState>) -> Response {
    no_store(json!({
        "status": "ok",
        "name": "ZimaForge",
        "version": crate::VERSION,
        // Ziel des Proxys (ZIMAFORGE_UPSTREAM), z. B. http://127.0.0.1:8081 – für die Einstellungen.
        "upstream": state.config.upstream.to_string().trim_end_matches('/'),
        "port": state.config.listen.port(),
    }))
}

async fn list_active(State(state): State<AppState>) -> ApiResult {
    let store = state.store.clone();
    let mods = blocking(move || Ok(store.active())).await?;
    Ok(no_store(json!({ "mods": mods })))
}

async fn store(State(state): State<AppState>) -> ApiResult {
    let store = state.store.clone();
    let entries = blocking(move || Ok(store.store())).await?;
    Ok(no_store(json!({ "version": crate::VERSION, "mods": entries })))
}

async fn install(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> ApiResult {
    state.auth.check(&headers).await?;
    let _guard = state.write_lock.lock().await;
    let store = state.store.clone();
    let info = blocking(move || store.install(&id)).await?;
    state.boot.invalidate().await;
    tracing::info!(id = %info.id, version = %info.version, "Mod installiert");
    Ok(no_store(json!({ "installed": info })))
}

async fn uninstall(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> ApiResult {
    state.auth.check(&headers).await?;
    let _guard = state.write_lock.lock().await;
    let store = state.store.clone();
    let id2 = id.clone();
    blocking(move || store.uninstall(&id2)).await?;
    state.boot.invalidate().await;
    tracing::info!(%id, "Mod entfernt");
    Ok(no_store(json!({ "uninstalled": id })))
}

#[derive(Deserialize)]
struct EnabledBody {
    enabled: bool,
}

async fn set_enabled(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    state.auth.check(&headers).await?;
    let EnabledBody { enabled } =
        serde_json::from_slice(&body).map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?;
    let _guard = state.write_lock.lock().await;
    let store = state.store.clone();
    let id2 = id.clone();
    blocking(move || store.set_enabled(&id2, enabled)).await?;
    state.boot.invalidate().await;
    Ok(no_store(json!({ "id": id, "enabled": enabled })))
}

/// Alle Einstellungen auf einmal (ZimaForge und aktive Mods): Der Loader holt sie
/// beim Start mit einer Anfrage statt einer je Mod.
async fn read_all_config(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    state.auth.check_session(&headers).await?;
    let store = state.store.clone();
    let config = blocking(move || Ok(crate::boot::configs(&store))).await?;
    Ok(no_store(json!({ "config": config })))
}

async fn read_config(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> ApiResult {
    // Einstellungen können Privates enthalten (Ort, Adressen, Schlüssel): nur angemeldet.
    state.auth.check_session(&headers).await?;
    let store = state.store.clone();
    let config = blocking(move || store.read_config(&id)).await?;
    Ok(no_store(json!({ "config": config })))
}

async fn write_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    state.auth.check(&headers).await?;
    let _guard = state.write_lock.lock().await;
    let store = state.store.clone();
    let config = blocking(move || store.write_config(&id, &body)).await?;
    Ok(no_store(json!({ "config": config })))
}

async fn metrics(State(state): State<AppState>) -> Response {
    no_store(serde_json::to_value(state.metrics.snapshot().await).unwrap_or_default())
}

async fn system(State(state): State<AppState>) -> Response {
    no_store(serde_json::to_value(state.system.snapshot().await).unwrap_or_default())
}

async fn session(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    state.auth.check(&headers).await?;
    Ok(no_store(json!({ "authenticated": true })))
}

/// Ob die URL eine Version trägt (`?v=…`) – dann ändert sich der Inhalt unter
/// dieser URL nie, und der Browser darf dauerhaft cachen.
#[derive(Deserialize, Default)]
struct AssetQuery {
    v: Option<String>,
}

/// Liefert eine Datei mit passendem Typ und Cache-Verhalten aus:
/// mit Version `immutable`, sonst ETag und `304 Not Modified` bei unverändertem Inhalt.
/// Mit Version wird kein ETag berechnet – der Browser fragt dann nie nach.
fn asset_response(bytes: Bytes, path: &str, versioned: bool, request: &HeaderMap, hash: Option<[u8; 32]>) -> Response {
    let etag = (!versioned).then(|| {
        let hash: [u8; 32] = hash.unwrap_or_else(|| Sha256::digest(&bytes).into());
        format!("\"{}\"", &hex::encode(hash)[..16])
    });
    let not_modified = etag.as_deref().is_some_and(|etag| {
        request
            .get(header::IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.split(',').any(|t| t.trim() == etag))
    });
    let mut resp = if not_modified {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        Response::new(Body::from(bytes))
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let h = resp.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    h.insert(
        header::CACHE_CONTROL,
        // Im Debug-Build nie dauerhaft cachen, damit Änderungen sofort sichtbar sind.
        HeaderValue::from_static(if versioned && !cfg!(debug_assertions) {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        }),
    );
    if let Some(v) = etag.and_then(|e| HeaderValue::from_str(&e).ok()) {
        h.insert(header::ETAG, v);
    }
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    resp
}

async fn runtime_asset(Path(path): Path<String>, Query(q): Query<AssetQuery>, headers: HeaderMap) -> Response {
    match Runtime::get(&path) {
        Some(file) if mods::valid_asset_path(&path) => {
            let data = match file.data {
                std::borrow::Cow::Borrowed(b) => Bytes::from_static(b),
                std::borrow::Cow::Owned(v) => Bytes::from(v),
            };
            asset_response(data, &path, q.v.is_some(), &headers, Some(file.metadata.sha256_hash()))
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn file_asset(file: Option<std::path::PathBuf>, path: &str, q: AssetQuery, headers: &HeaderMap) -> Response {
    let Some(file) = file else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(&file).await {
        Ok(bytes) => asset_response(Bytes::from(bytes), path, q.v.is_some(), headers, None),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn catalog_asset(
    State(state): State<AppState>,
    Path((id, path)): Path<(String, String)>,
    Query(q): Query<AssetQuery>,
    headers: HeaderMap,
) -> Response {
    file_asset(state.store.catalog_asset_path(&id, &path), &path, q, &headers).await
}

async fn mod_asset(
    State(state): State<AppState>,
    Path((id, path)): Path<(String, String)>,
    Query(q): Query<AssetQuery>,
    headers: HeaderMap,
) -> Response {
    file_asset(state.store.asset_path(&id, &path), &path, q, &headers).await
}
