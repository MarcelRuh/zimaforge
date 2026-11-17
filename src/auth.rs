//! Schutz der schreibenden API.
//!
//! Statt eines eigenen API-Schlüssels (den man kopieren und einfügen müsste)
//! gilt die **ZimaOS-Anmeldung selbst**: Der Browser schickt den Sitzungstoken
//! des Dashboards mit, ZimaForge prüft ihn beim Gateway (`/v1/users/current`).
//! Zusätzlich gegen CSRF: eigener Header (erzwingt bei fremden Origins einen
//! Preflight, den ZimaForge nie erlaubt) und Origin-Abgleich.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode, Uri, header};
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::proxy::HttpClient;

pub const CSRF_HEADER: &str = "x-zimaforge";
const CACHE_TTL: Duration = Duration::from_secs(60);
const CACHE_MAX: usize = 256;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("Anfrage ohne ZimaForge-Header")]
    MissingCsrfHeader,
    #[error("fremder Ursprung")]
    ForeignOrigin,
    #[error("ZimaOS-Anmeldung erforderlich")]
    Unauthenticated,
    #[error("nur für ZimaOS-Administratoren")]
    NotAdmin,
}

impl AuthError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::MissingCsrfHeader | Self::ForeignOrigin | Self::NotAdmin => StatusCode::FORBIDDEN,
            Self::Unauthenticated => StatusCode::UNAUTHORIZED,
        }
    }
}

/// Geprüfte Sitzung: wann geprüft und ob der Benutzer Administrator ist.
#[derive(Clone, Copy)]
struct Session {
    at: Instant,
    admin: bool,
}

#[derive(Clone)]
pub struct SessionValidator {
    client: HttpClient,
    upstream: Uri,
    cache: Arc<Mutex<HashMap<[u8; 32], Session>>>,
}

impl SessionValidator {
    pub fn new(client: HttpClient, upstream: Uri) -> Self {
        Self {
            client,
            upstream,
            cache: Arc::default(),
        }
    }

    /// Schreibende Anfrage: CSRF-Schutz, gültige Sitzung und Administratorrechte.
    /// Mods laufen im Browser jedes Benutzers – installieren darf sie nur ein Admin.
    pub async fn check(&self, headers: &HeaderMap) -> Result<(), AuthError> {
        check_request_origin(headers)?;
        if self.session(headers).await?.admin {
            Ok(())
        } else {
            Err(AuthError::NotAdmin)
        }
    }

    /// Lesende Anfrage mit privaten Daten (Mod-Einstellungen): gültige Sitzung genügt.
    pub async fn check_session(&self, headers: &HeaderMap) -> Result<(), AuthError> {
        self.session(headers).await.map(|_| ())
    }

    async fn session(&self, headers: &HeaderMap) -> Result<Session, AuthError> {
        let token = headers
            .get(header::AUTHORIZATION)
            .filter(|v| !v.is_empty() && v.len() <= 8192)
            .ok_or(AuthError::Unauthenticated)?;

        let key: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        {
            let cache = self.cache.lock().await;
            if let Some(s) = cache.get(&key).filter(|s| s.at.elapsed() < CACHE_TTL) {
                return Ok(*s);
            }
        }

        let mut parts = self.upstream.clone().into_parts();
        parts.path_and_query = Some("/v1/users/current".parse().expect("statischer Pfad"));
        let uri = Uri::from_parts(parts).expect("gültige URI");
        let mut req = Request::get(uri).body(Body::empty()).expect("gültige Anfrage");
        req.headers_mut().insert(header::AUTHORIZATION, token.clone());

        let request = async {
            let resp = self.client.request(req).await?;
            if !resp.status().is_success() {
                return Ok::<_, hyper_util::client::legacy::Error>(None);
            }
            // Antwort höchstens 64 KiB; ohne lesbare Rolle gilt der Benutzer als Admin
            // (ZimaOS kennt in der Regel nur Administratoren).
            let body = http_body_util::Limited::new(resp.into_body(), 64 * 1024)
                .collect()
                .await
                .map(|b| b.to_bytes())
                .unwrap_or_default();
            Ok(Some(is_admin(&body)))
        };
        let admin = match tokio::time::timeout(Duration::from_secs(5), request).await {
            Ok(Ok(Some(admin))) => admin,
            Ok(Ok(None)) => return Err(AuthError::Unauthenticated),
            Ok(Err(err)) => {
                tracing::warn!(error = %err, "Sitzungsprüfung beim Gateway fehlgeschlagen");
                return Err(AuthError::Unauthenticated);
            }
            Err(_) => {
                tracing::warn!("Sitzungsprüfung beim Gateway: keine Antwort innerhalb von 5 s");
                return Err(AuthError::Unauthenticated);
            }
        };

        let session = Session {
            at: Instant::now(),
            admin,
        };
        let mut cache = self.cache.lock().await;
        if cache.len() >= CACHE_MAX {
            cache.retain(|_, s| s.at.elapsed() < CACHE_TTL);
            if cache.len() >= CACHE_MAX {
                cache.clear();
            }
        }
        cache.insert(key, session);
        Ok(session)
    }
}

/// Rolle aus `/v1/users/current` (`{"data":{"role":"admin"}}`). Fehlt sie, gilt Admin.
fn is_admin(body: &[u8]) -> bool {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) else {
        return true;
    };
    let user = json.get("data").unwrap_or(&json);
    match user.get("role").and_then(|r| r.as_str()) {
        Some(role) => role.eq_ignore_ascii_case("admin"),
        None => true,
    }
}

/// CSRF-Prüfung ohne Netzwerk: eigener Header Pflicht, Origin muss zum Host passen.
pub fn check_request_origin(headers: &HeaderMap) -> Result<(), AuthError> {
    if headers.get(CSRF_HEADER).is_none_or(|v| v.as_bytes() != b"1") {
        return Err(AuthError::MissingCsrfHeader);
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let host = headers
            .get(header::HOST)
            .and_then(|h| h.to_str().ok())
            .ok_or(AuthError::ForeignOrigin)?;
        let origin_host = origin
            .to_str()
            .ok()
            .and_then(|o| o.parse::<Uri>().ok())
            .and_then(|u| u.authority().map(|a| a.as_str().to_ascii_lowercase()))
            .ok_or(AuthError::ForeignOrigin)?;
        if origin_host != host.to_ascii_lowercase() {
            return Err(AuthError::ForeignOrigin);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_static(v));
        }
        h
    }

    #[test]
    fn admin_role() {
        assert!(is_admin(br#"{"data":{"username":"a","role":"admin"}}"#));
        assert!(is_admin(br#"{"data":{"username":"a","role":"ADMIN"}}"#));
        assert!(!is_admin(br#"{"data":{"username":"b","role":"user"}}"#));
        assert!(is_admin(br#"{"data":{"username":"a"}}"#), "ohne Rolle: Admin");
        assert!(is_admin(b"kein json"));
    }

    #[test]
    fn csrf_rules() {
        assert_eq!(check_request_origin(&headers(&[])), Err(AuthError::MissingCsrfHeader));
        assert_eq!(check_request_origin(&headers(&[(CSRF_HEADER, "1")])), Ok(()));
        assert_eq!(
            check_request_origin(&headers(&[
                (CSRF_HEADER, "1"),
                ("host", "zima:8088"),
                ("origin", "http://zima:8088")
            ])),
            Ok(())
        );
        assert_eq!(
            check_request_origin(&headers(&[
                (CSRF_HEADER, "1"),
                ("host", "zima:8088"),
                ("origin", "http://evil.example")
            ])),
            Err(AuthError::ForeignOrigin)
        );
        assert_eq!(
            check_request_origin(&headers(&[
                (CSRF_HEADER, "1"),
                ("host", "zima:8088"),
                ("origin", "null")
            ])),
            Err(AuthError::ForeignOrigin)
        );
    }
}
