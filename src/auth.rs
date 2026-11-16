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
}

impl AuthError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::MissingCsrfHeader | Self::ForeignOrigin => StatusCode::FORBIDDEN,
            Self::Unauthenticated => StatusCode::UNAUTHORIZED,
        }
    }
}

#[derive(Clone)]
pub struct SessionValidator {
    client: HttpClient,
    upstream: Uri,
    cache: Arc<Mutex<HashMap<[u8; 32], Instant>>>,
}

impl SessionValidator {
    pub fn new(client: HttpClient, upstream: Uri) -> Self {
        Self {
            client,
            upstream,
            cache: Arc::default(),
        }
    }

    pub async fn check(&self, headers: &HeaderMap) -> Result<(), AuthError> {
        check_request_origin(headers)?;
        let token = headers
            .get(header::AUTHORIZATION)
            .filter(|v| !v.is_empty() && v.len() <= 8192)
            .ok_or(AuthError::Unauthenticated)?;

        let key: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        {
            let cache = self.cache.lock().await;
            if cache.get(&key).is_some_and(|at| at.elapsed() < CACHE_TTL) {
                return Ok(());
            }
        }

        let mut parts = self.upstream.clone().into_parts();
        parts.path_and_query = Some("/v1/users/current".parse().expect("statischer Pfad"));
        let uri = Uri::from_parts(parts).expect("gültige URI");
        let mut req = Request::get(uri).body(Body::empty()).expect("gültige Anfrage");
        req.headers_mut().insert(header::AUTHORIZATION, token.clone());

        let ok = match tokio::time::timeout(Duration::from_secs(5), self.client.request(req)).await {
            Ok(Ok(resp)) => resp.status().is_success(),
            Ok(Err(err)) => {
                tracing::warn!(error = %err, "Sitzungsprüfung beim Gateway fehlgeschlagen");
                false
            }
            Err(_) => false,
        };
        if !ok {
            return Err(AuthError::Unauthenticated);
        }

        let mut cache = self.cache.lock().await;
        if cache.len() >= CACHE_MAX {
            cache.retain(|_, at| at.elapsed() < CACHE_TTL);
            if cache.len() >= CACHE_MAX {
                cache.clear();
            }
        }
        cache.insert(key, Instant::now());
        Ok(())
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
