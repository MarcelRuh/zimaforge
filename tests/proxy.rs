//! Ende-zu-Ende-Tests: ZimaForge vor einem simulierten ZimaOS-Gateway.

use std::net::SocketAddr;
use std::path::Path;

use axum::Router;
use axum::extract::ws::{Message as AxMessage, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use zimaforge::{AppState, Config, app};

const GOOD_TOKEN: &str = "zimaos-session-token";
/// Angemeldet, aber kein Administrator.
const USER_TOKEN: &str = "zimaos-user-token";

async fn spawn(router: Router) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });
    addr
}

/// Simuliertes ZimaOS-Gateway.
fn fake_zimaos() -> Router {
    Router::new()
        .route(
            "/",
            get(|| async {
                Html("<!doctype html><html><head><title>ZimaOS</title></head><body><div id=app></div></body></html>")
            }),
        )
        .route(
            "/v1/sys/echo",
            get(|headers: HeaderMap| async move {
                axum::Json(serde_json::json!({
                    "acceptEncoding": headers.get(header::ACCEPT_ENCODING).is_some(),
                    "forwardedHost": headers.get("x-forwarded-host").and_then(|v| v.to_str().ok()),
                    "forwardedPort": headers.get("x-forwarded-port").and_then(|v| v.to_str().ok()),
                    "realIp": headers.get("x-real-ip").and_then(|v| v.to_str().ok()),
                    "forwardedFor": headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
                }))
            }),
        )
        .route(
            "/v1/users/current",
            get(|headers: HeaderMap| async move {
                if headers.get(header::AUTHORIZATION).is_some_and(|v| v == GOOD_TOKEN) {
                    (StatusCode::OK, "{\"data\":{\"username\":\"admin\"}}").into_response()
                } else if headers.get(header::AUTHORIZATION).is_some_and(|v| v == USER_TOKEN) {
                    (StatusCode::OK, "{\"data\":{\"username\":\"gast\",\"role\":\"user\"}}").into_response()
                } else {
                    StatusCode::UNAUTHORIZED.into_response()
                }
            }),
        )
        .route(
            "/download.bin",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/octet-stream")],
                    vec![7u8; 64 * 1024],
                )
            }),
        )
        .route(
            "/v2/settings/fe.custom",
            get(|| async { (StatusCode::BAD_REQUEST, "missing") }),
        )
        .route(
            "/v2/message_bus/ws",
            get(|ws: WebSocketUpgrade| async move {
                ws.on_upgrade(|mut socket| async move {
                    while let Some(Ok(msg)) = socket.recv().await {
                        if let AxMessage::Text(t) = msg {
                            let _ = socket.send(AxMessage::Text(format!("echo:{t}").into())).await;
                        }
                    }
                })
            }),
        )
}

struct Forge {
    addr: SocketAddr,
    _tmp: tempfile::TempDir,
    http: reqwest_lite::Client,
}

fn write(path: &Path, content: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

async fn forge_with_upstream(upstream: &str) -> Forge {
    let tmp = tempfile::tempdir().unwrap();
    let catalog = tmp.path().join("catalog");
    write(
        &catalog.join("neon/forge.json"),
        r#"{"name":"Neon","version":"1.0.0","scripts":["mod.js"]}"#,
    );
    write(&catalog.join("neon/mod.js"), "console.log('neon')");
    let cfg = Config::from_lookup(|k| match k {
        "ZIMAFORGE_UPSTREAM" => Some(upstream.to_owned()),
        "ZIMAFORGE_DATA" => Some(tmp.path().join("data").to_string_lossy().into_owned()),
        "ZIMAFORGE_CATALOG" => Some(catalog.to_string_lossy().into_owned()),
        "ZIMAFORGE_PROC" => Some(tmp.path().join("proc").to_string_lossy().into_owned()),
        "ZIMAFORGE_SYS" => Some(tmp.path().join("sys").to_string_lossy().into_owned()),
        _ => None,
    })
    .unwrap();
    let state = AppState::new(cfg);
    state.store.ensure_layout().unwrap();
    let addr = spawn(app(state)).await;
    Forge {
        addr,
        _tmp: tmp,
        http: reqwest_lite::Client::new(),
    }
}

async fn forge() -> Forge {
    let upstream = spawn(fake_zimaos()).await;
    forge_with_upstream(&format!("http://{upstream}")).await
}

impl Forge {
    fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }
}

/// Minimaler HTTP/1.1-Client auf Basis von hyper – vermeidet eine reqwest-Abhängigkeit.
mod reqwest_lite {
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use http_body_util::BodyExt;
    use hyper_util::client::legacy::Client as HClient;
    use hyper_util::client::legacy::connect::HttpConnector;
    use hyper_util::rt::TokioExecutor;

    pub struct Client(HClient<HttpConnector, Body>);

    pub struct Resp {
        pub status: StatusCode,
        pub headers: axum::http::HeaderMap,
        pub body: String,
    }

    impl Client {
        pub fn new() -> Self {
            Self(HClient::builder(TokioExecutor::new()).build(HttpConnector::new()))
        }

        pub async fn send(&self, method: Method, url: &str, headers: &[(&str, &str)], body: &str) -> Resp {
            let mut req = Request::builder().method(method).uri(url);
            for (k, v) in headers {
                req = req.header(*k, *v);
            }
            let resp = self
                .0
                .request(req.body(Body::from(body.to_owned())).unwrap())
                .await
                .unwrap();
            let status = resp.status();
            let headers = resp.headers().clone();
            let body = String::from_utf8_lossy(&resp.into_body().collect().await.unwrap().to_bytes()).into_owned();
            Resp { status, headers, body }
        }

        pub async fn get(&self, url: &str) -> Resp {
            self.send(Method::GET, url, &[], "").await
        }

        /// Seitenaufruf wie ein Browser (Adresszeile).
        pub async fn page(&self, url: &str) -> Resp {
            let doc = [("sec-fetch-dest", "document"), ("accept", "text/html,*/*")];
            self.send(Method::GET, url, &doc, "").await
        }
    }
}

use axum::http::Method;

#[tokio::test]
async fn injects_loader_into_dashboard_html() {
    let f = forge().await;
    let r = f.http.page(&f.url("/")).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.body.contains("/_forge/runtime/loader.js?v="), "{}", r.body);
    assert!(r.body.contains("data-zimaforge-loader></script></head>"));
    assert_eq!(
        r.headers.get(header::CONTENT_LENGTH).unwrap().to_str().unwrap(),
        r.body.len().to_string()
    );
    assert_eq!(r.headers.get("x-zimaforge-version").unwrap(), zimaforge::VERSION);
}

#[tokio::test]
async fn passes_api_calls_through_with_forward_headers() {
    let f = forge().await;
    // zstd: kommt beim Upstream an, ZimaForge selbst komprimiert damit aber nicht.
    let r = f
        .http
        .send(Method::GET, &f.url("/v1/sys/echo"), &[("accept-encoding", "zstd")], "")
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(v["acceptEncoding"], true, "API-Aufrufe bleiben komprimierbar");
    let doc = f
        .http
        .send(
            Method::GET,
            &f.url("/v1/sys/echo"),
            &[("accept-encoding", "zstd"), ("sec-fetch-dest", "document")],
            "",
        )
        .await;
    let v: serde_json::Value = serde_json::from_str(&doc.body).unwrap();
    assert_eq!(
        v["acceptEncoding"], false,
        "Seitenaufrufe unkomprimiert für die Loader-Injection"
    );
    assert_eq!(v["forwardedHost"], f.addr.to_string());
    assert_eq!(v["forwardedPort"], "8077", "Port aus der ZimaForge-Konfiguration");
    assert_eq!(v["realIp"], "127.0.0.1");
}

#[tokio::test]
async fn fe_custom_workaround() {
    let f = forge().await;
    let r = f.http.get(&f.url("/v2/settings/fe.custom")).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body, r#"{"data":{}}"#);
}

#[tokio::test]
async fn upstream_down_gives_branded_502() {
    // Port 9 (discard) ist lokal praktisch nie belegt.
    let f = forge_with_upstream("http://127.0.0.1:9").await;
    let r = f.http.page(&f.url("/")).await;
    assert_eq!(r.status, StatusCode::BAD_GATEWAY);
    assert!(r.body.contains("ZimaOS-Gateway nicht erreichbar"));
}

#[tokio::test]
async fn tunnels_websockets() {
    let f = forge().await;
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/v2/message_bus/ws", f.addr))
        .await
        .unwrap();
    ws.send(Message::Text("ping".into())).await.unwrap();
    let reply = ws.next().await.unwrap().unwrap();
    assert_eq!(reply.into_text().unwrap().as_str(), "echo:ping");
}

#[tokio::test]
async fn write_api_requires_zimaos_session() {
    let f = forge().await;
    let url = f.url("/_forge/api/store/neon");

    let r = f.http.send(Method::POST, &url, &[], "").await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "ohne CSRF-Header");

    let r = f.http.send(Method::POST, &url, &[("x-zimaforge", "1")], "").await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED, "ohne Token");

    let r = f
        .http
        .send(
            Method::POST,
            &url,
            &[("x-zimaforge", "1"), ("authorization", "wrong")],
            "",
        )
        .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED, "falscher Token");

    let r = f
        .http
        .send(
            Method::POST,
            &url,
            &[
                ("x-zimaforge", "1"),
                ("authorization", GOOD_TOKEN),
                ("origin", "http://evil.example"),
            ],
            "",
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN, "fremder Origin");

    let r = f
        .http
        .send(
            Method::POST,
            &url,
            &[("x-zimaforge", "1"), ("authorization", GOOD_TOKEN)],
            "",
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

#[tokio::test]
async fn store_lifecycle_and_assets() {
    let f = forge().await;
    let auth = [("x-zimaforge", "1"), ("authorization", GOOD_TOKEN)];

    let store: serde_json::Value = serde_json::from_str(&f.http.get(&f.url("/_forge/api/store")).await.body).unwrap();
    assert_eq!(store["mods"][0]["id"], "neon");
    assert_eq!(store["mods"][0]["installed"], false);
    let r = f.http.get(&f.url("/_forge/catalog/neon/mod.js")).await;
    assert_eq!(r.status, StatusCode::OK, "Katalog-Dateien vor der Installation");
    assert_eq!(
        f.http.get(&f.url("/_forge/catalog/neon/..%2F..%2Fx")).await.status,
        StatusCode::NOT_FOUND
    );

    assert_eq!(
        f.http
            .send(Method::POST, &f.url("/_forge/api/store/neon"), &auth, "")
            .await
            .status,
        StatusCode::OK
    );
    let active: serde_json::Value = serde_json::from_str(&f.http.get(&f.url("/_forge/api/mods")).await.body).unwrap();
    assert_eq!(active["mods"][0]["scripts"][0], "mod.js");

    for path in ["/_forge/mods/neon/mod.js", "/mod/neon/mod.js"] {
        let r = f.http.get(&f.url(path)).await;
        assert_eq!(r.status, StatusCode::OK, "{path}");
        assert_eq!(r.body, "console.log('neon')");
        assert!(
            r.headers
                .get(header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap()
                .contains("javascript")
        );
    }
    assert_eq!(
        f.http.get(&f.url("/_forge/mods/neon/forge.json/../../x")).await.status,
        StatusCode::NOT_FOUND
    );

    let r = f
        .http
        .send(
            Method::PUT,
            &f.url("/_forge/api/mods/neon/enabled"),
            &auth,
            r#"{"enabled":false}"#,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
    let active: serde_json::Value = serde_json::from_str(&f.http.get(&f.url("/_forge/api/mods")).await.body).unwrap();
    assert_eq!(active["mods"].as_array().unwrap().len(), 0);

    let r = f
        .http
        .send(
            Method::PUT,
            &f.url("/_forge/api/config/neon"),
            &auth,
            r#"{"color":"pink"}"#,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let cfg: serde_json::Value = serde_json::from_str(
        &f.http
            .send(Method::GET, &f.url("/_forge/api/config/neon"), &auth, "")
            .await
            .body,
    )
    .unwrap();
    assert_eq!(cfg["config"]["color"], "pink");

    let r = f
        .http
        .send(Method::PUT, &f.url("/_forge/api/config/neon"), &auth, "not json")
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    assert_eq!(
        f.http
            .send(Method::DELETE, &f.url("/_forge/api/store/neon"), &auth, "")
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        f.http.get(&f.url("/_forge/mods/neon/mod.js")).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn serves_runtime_and_health() {
    let f = forge().await;
    let r = f.http.get(&f.url("/_forge/runtime/loader.js")).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(
        r.headers
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("javascript")
    );
    assert_eq!(
        f.http.get(&f.url("/_forge/runtime/nope.js")).await.status,
        StatusCode::NOT_FOUND
    );
    let h: serde_json::Value = serde_json::from_str(&f.http.get(&f.url("/_forge/api/health")).await.body).unwrap();
    assert_eq!(h["status"], "ok");
    assert!(h["upstream"].as_str().unwrap().starts_with("http://127.0.0.1:"));
}

#[tokio::test]
async fn compresses_own_assets_and_supports_etags() {
    let f = forge().await;
    let url = f.url("/_forge/runtime/store.js?v=1");
    let r = f.http.send(Method::GET, &url, &[("accept-encoding", "gzip")], "").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers.get(header::CONTENT_ENCODING).unwrap(), "gzip");

    let r = f.http.get(&f.url("/_forge/runtime/loader.js")).await;
    let etag = r.headers.get(header::ETAG).unwrap().to_str().unwrap().to_owned();
    let again = f
        .http
        .send(
            Method::GET,
            &f.url("/_forge/runtime/loader.js"),
            &[("if-none-match", etag.as_str())],
            "",
        )
        .await;
    assert_eq!(again.status, StatusCode::NOT_MODIFIED);
    assert!(again.body.is_empty());
}

#[tokio::test]
async fn active_mods_carry_a_revision_stamp() {
    let f = forge().await;
    let auth = [("x-zimaforge", "1"), ("authorization", GOOD_TOKEN)];
    f.http
        .send(Method::POST, &f.url("/_forge/api/store/neon"), &auth, "")
        .await;
    let v: serde_json::Value = serde_json::from_str(&f.http.get(&f.url("/_forge/api/mods")).await.body).unwrap();
    let rev = v["mods"][0]["rev"].as_u64().unwrap();
    assert!(rev > 0);

    // Die Dashboard-Seite bringt aktive Mods, Einstellungen und Preloads gleich mit.
    let page = f.http.page(&f.url("/")).await.body;
    let start = page
        .find(r#"<script type="application/json" id="zimaforge-boot">"#)
        .expect(&page);
    let json = &page[start..];
    let json = &json[json.find('>').unwrap() + 1..json.find("</script>").unwrap()];
    let boot: serde_json::Value = serde_json::from_str(json).unwrap();
    assert_eq!(boot["version"], zimaforge::VERSION);
    assert_eq!(boot["mods"][0]["id"], "neon");
    assert!(boot.get("config").is_none(), "Einstellungen nie in der Seite");

    // Einstellungen: eine Anfrage, nur angemeldet.
    let all = f.http.send(Method::GET, &f.url("/_forge/api/config"), &auth, "").await;
    assert_eq!(all.status, StatusCode::OK);
    let all: serde_json::Value = serde_json::from_str(&all.body).unwrap();
    assert!(all["config"].get("zimaforge").is_some() && all["config"].get("neon").is_some());
    assert_eq!(
        f.http.get(&f.url("/_forge/api/config")).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert!(page.contains(&format!(
        r#"<link rel="preload" as="script" href="/_forge/mods/neon/mod.js?v=1.0.0-{rev}">"#
    )));
    assert!(page.find("zimaforge-boot").unwrap() < page.find("data-zimaforge-loader").unwrap());
}

#[tokio::test]
async fn injects_only_into_page_loads() {
    let f = forge().await;
    // HEAD: Kopfzeilen wie bei GET, aber nichts eingefügt.
    let head = f
        .http
        .send(Method::HEAD, &f.url("/"), &[("sec-fetch-dest", "document")], "")
        .await;
    assert!(!head.body.contains("zimaforge"));
    // HTML per fetch (z. B. Dateivorschau) bleibt unverändert.
    let fetched = f
        .http
        .send(Method::GET, &f.url("/"), &[("sec-fetch-dest", "empty")], "")
        .await;
    assert_eq!(fetched.status, StatusCode::OK);
    assert!(!fetched.body.contains("data-zimaforge-loader"));
    // iframe-Seiten bekommen den Loader (er beendet sich dort selbst).
    let frame = f
        .http
        .send(Method::GET, &f.url("/"), &[("sec-fetch-dest", "iframe")], "")
        .await;
    assert!(frame.body.contains("data-zimaforge-loader"));
}

#[tokio::test]
async fn downloads_are_not_recompressed() {
    let f = forge().await;
    let r = f
        .http
        .send(Method::GET, &f.url("/download.bin"), &[("accept-encoding", "gzip")], "")
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.headers.get(header::CONTENT_ENCODING).is_none());
    assert_eq!(r.headers.get(header::CONTENT_LENGTH).unwrap(), "65536");
}

#[tokio::test]
async fn forwarded_for_cannot_be_spoofed() {
    let f = forge().await;
    let r = f
        .http
        .send(
            Method::GET,
            &f.url("/v1/sys/echo"),
            &[("x-forwarded-for", "6.6.6.6")],
            "",
        )
        .await;
    let echo: serde_json::Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(echo["forwardedFor"], "127.0.0.1");
}

#[tokio::test]
async fn private_reads_and_admin_writes() {
    let f = forge().await;
    let admin = [("x-zimaforge", "1"), ("authorization", GOOD_TOKEN)];
    let user = [("x-zimaforge", "1"), ("authorization", USER_TOKEN)];

    // Einstellungen lesen: nur angemeldet (Rolle egal).
    assert_eq!(
        f.http.get(&f.url("/_forge/api/config/zimaforge")).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        f.http
            .send(Method::GET, &f.url("/_forge/api/config/zimaforge"), &user, "")
            .await
            .status,
        StatusCode::OK
    );
    // Installieren: nur Administratoren.
    assert_eq!(
        f.http
            .send(Method::POST, &f.url("/_forge/api/store/neon"), &user, "")
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    // Einstellungen nur für installierte Mods.
    assert_eq!(
        f.http
            .send(Method::PUT, &f.url("/_forge/api/config/gibts-nicht"), &admin, "{}")
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}
