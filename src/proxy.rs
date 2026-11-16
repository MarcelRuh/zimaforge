//! Reverse-Proxy vor dem ZimaOS-Gateway: reicht alles durch, schleust den
//! Loader in HTML-Seiten ein und tunnelt WebSocket-Verbindungen.

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, Response, StatusCode, Uri, header};
use axum::response::IntoResponse;
use http_body_util::BodyExt;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};

use crate::inject::inject;
use crate::state::AppState;

pub type HttpClient = Client<HttpConnector, Body>;

/// Größte HTML-Seite, die zum Einschleusen gepuffert wird.
const MAX_HTML_BYTES: usize = 16 * 1024 * 1024;
/// Marker, an dem eine bereits injizierte Seite erkannt wird.
pub const LOADER_MARKER: &str = "data-zimaforge-loader";

pub fn client() -> HttpClient {
    let mut connector = HttpConnector::new();
    connector.set_nodelay(true);
    connector.set_connect_timeout(Some(std::time::Duration::from_secs(5)));
    Client::builder(TokioExecutor::new())
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build(connector)
}

pub fn loader_tag() -> String {
    format!(
        r#"<script type="module" src="/_forge/runtime/loader.js?v={v}" {LOADER_MARKER}></script>"#,
        v = crate::VERSION
    )
}

const HOP_BY_HOP: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

fn strip_hop_by_hop(headers: &mut HeaderMap) {
    // Header, die im Connection-Header selbst als hop-by-hop markiert sind.
    let listed: Vec<HeaderName> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect();
    for name in listed {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(name);
    }
}

fn is_upgrade(headers: &HeaderMap) -> bool {
    headers.contains_key(header::UPGRADE)
        && headers
            .get_all(header::CONNECTION)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .any(|v| v.split(',').any(|t| t.trim().eq_ignore_ascii_case("upgrade")))
}

fn upstream_uri(base: &Uri, original: &Uri) -> Uri {
    let pq = original.path_and_query().map_or("/", |pq| pq.as_str());
    let mut parts = base.clone().into_parts();
    parts.path_and_query = Some(pq.parse().expect("path and query from a valid URI"));
    Uri::from_parts(parts).expect("valid upstream URI")
}

/// Fallback-Handler: alles, was nicht ZimaForge selbst gehört, geht ans Gateway.
pub async fn forward(State(state): State<AppState>, mut req: Request<Body>) -> Response<Body> {
    let client_addr = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
    let upgrade = is_upgrade(req.headers());
    let client_upgrade = upgrade.then(|| hyper::upgrade::on(&mut req));

    let (mut parts, body) = req.into_parts();
    let path = parts.uri.path().to_owned();
    let is_get = parts.method == axum::http::Method::GET;
    parts.uri = upstream_uri(&state.config.upstream, &parts.uri);

    let upgrade_value = parts.headers.get(header::UPGRADE).cloned();
    strip_hop_by_hop(&mut parts.headers);
    if let Some(value) = upgrade_value.filter(|_| upgrade) {
        parts.headers.insert(header::UPGRADE, value);
        parts
            .headers
            .insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    }
    // Unkomprimiert anfordern, damit HTML verändert werden kann (lokale Strecke).
    parts.headers.remove(header::ACCEPT_ENCODING);
    if let Some(host) = parts.headers.get(header::HOST).cloned() {
        parts.headers.insert("x-forwarded-host", host);
    }
    parts
        .headers
        .insert("x-forwarded-proto", HeaderValue::from_static("http"));
    // Damit ZimaOS Links und Weiterleitungen auf den Port von ZimaForge bezieht
    // (z. B. 80, wenn ZimaOS selbst auf 8081 verschoben wurde).
    parts
        .headers
        .insert("x-forwarded-port", HeaderValue::from(state.config.listen.port()));
    if let Some(addr) = client_addr
        && let Ok(ip) = HeaderValue::from_str(&addr.ip().to_string())
    {
        parts.headers.insert("x-real-ip", ip.clone());
        parts.headers.append("x-forwarded-for", ip);
    }

    let upstream_req = Request::from_parts(parts, body);
    let mut resp = match state.client.request(upstream_req).await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::warn!(error = %err, "ZimaOS-Gateway nicht erreichbar");
            return gateway_error();
        }
    };

    if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
        if let Some(client_upgrade) = client_upgrade {
            let upstream_upgrade = hyper::upgrade::on(&mut resp);
            tokio::spawn(async move {
                match tokio::try_join!(client_upgrade, upstream_upgrade) {
                    Ok((client, upstream)) => {
                        let mut client = TokioIo::new(client);
                        let mut upstream = TokioIo::new(upstream);
                        if let Err(err) = tokio::io::copy_bidirectional(&mut client, &mut upstream).await {
                            tracing::debug!(error = %err, "WebSocket-Tunnel beendet");
                        }
                    }
                    Err(err) => tracing::warn!(error = %err, "Upgrade fehlgeschlagen"),
                }
            });
        }
        let (parts, _) = resp.into_parts();
        return Response::from_parts(parts, Body::empty());
    }

    let (mut parts, body) = resp.into_parts();
    strip_hop_by_hop(&mut parts.headers);

    // ZimaOS antwortet hinter einem Proxy auf fehlende Frontend-Einstellungen
    // mit 400, woran das Dashboard scheitert. Wie bei ZimaMOD: leeres Objekt.
    if is_get && path == "/v2/settings/fe.custom" && parts.status == StatusCode::BAD_REQUEST {
        return json_response(StatusCode::OK, r#"{"data":{}}"#);
    }

    if should_inject(parts.status, &parts.headers) {
        let bytes = match http_body_util::Limited::new(body, MAX_HTML_BYTES).collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(err) => {
                tracing::warn!(error = %err, "HTML-Antwort konnte nicht gelesen werden");
                return gateway_error();
            }
        };
        let html = inject(&bytes, &loader_tag(), LOADER_MARKER);
        parts.headers.remove(header::CONTENT_LENGTH);
        parts.headers.remove(header::ETAG);
        parts.headers.remove(header::LAST_MODIFIED);
        parts
            .headers
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        return Response::from_parts(parts, Body::from(html));
    }

    Response::from_parts(parts, Body::new(body))
}

fn should_inject(status: StatusCode, headers: &HeaderMap) -> bool {
    let html = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim_start().to_ascii_lowercase().starts_with("text/html"));
    let plain = headers
        .get(header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_none_or(|v| v.trim().eq_ignore_ascii_case("identity"));
    status == StatusCode::OK && html && plain
}

fn json_response(status: StatusCode, body: &'static str) -> Response<Body> {
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

fn gateway_error() -> Response<Body> {
    (
        StatusCode::BAD_GATEWAY,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        include_str!("../runtime/gateway-error.html"),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_uri_to_upstream() {
        let base: Uri = "http://127.0.0.1:80".parse().unwrap();
        let orig: Uri = "/v1/sys/info?x=1".parse().unwrap();
        assert_eq!(
            upstream_uri(&base, &orig).to_string(),
            "http://127.0.0.1:80/v1/sys/info?x=1"
        );
    }

    #[test]
    fn detects_upgrade() {
        let mut h = HeaderMap::new();
        h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        h.insert(header::CONNECTION, HeaderValue::from_static("keep-alive, Upgrade"));
        assert!(is_upgrade(&h));
        h.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
        assert!(!is_upgrade(&h));
    }

    #[test]
    fn strips_connection_listed_headers() {
        let mut h = HeaderMap::new();
        h.insert(header::CONNECTION, HeaderValue::from_static("x-secret"));
        h.insert("x-secret", HeaderValue::from_static("1"));
        h.insert("x-keep", HeaderValue::from_static("1"));
        strip_hop_by_hop(&mut h);
        assert!(!h.contains_key("x-secret"));
        assert!(h.contains_key("x-keep"));
    }

    #[test]
    fn injects_only_plain_ok_html() {
        let mut h = HeaderMap::new();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        assert!(should_inject(StatusCode::OK, &h));
        assert!(!should_inject(StatusCode::NOT_FOUND, &h));
        h.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        assert!(!should_inject(StatusCode::OK, &h));
        h.remove(header::CONTENT_ENCODING);
        h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        assert!(!should_inject(StatusCode::OK, &h));
    }
}
