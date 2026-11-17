//! Startdaten, die mit dem Loader in jede Dashboard-Seite eingefügt werden.
//!
//! Ohne sie wartet der Browser erst auf `/_forge/api/mods` und dann auf die
//! Mod-Dateien. Mit ihnen steht die Mod-Liste schon im HTML, und die Mod-Dateien
//! laden parallel zu ZimaOS (`preload`). Einstellungen stehen bewusst **nicht** darin:
//! Die Seite sieht auch, wer nicht angemeldet ist (Anmeldeseite). Der Loader holt sie
//! angemeldet mit einer einzigen Anfrage (`/_forge/api/config`).

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

use crate::mods::{CORE_CONFIG_ID, ModInfo, ModStore};
use crate::proxy::loader_tag;

/// Einstellungen von ZimaForge selbst und aller aktiven Mods (blockierend).
pub fn configs(store: &ModStore) -> Map<String, Value> {
    let mut config = Map::new();
    let mods = store.active();
    for id in std::iter::once(CORE_CONFIG_ID).chain(mods.iter().map(|m| m.id.as_str())) {
        if let Ok(value) = store.read_config(id) {
            config.insert(id.to_owned(), value);
        }
    }
    config
}

/// Wie lange die fertigen Tags wiederverwendet werden. Installieren, Entfernen und
/// Umschalten leeren den Zwischenspeicher sofort; die Frist fängt Änderungen ab,
/// die direkt im Mod-Ordner gemacht werden.
const CACHE_TTL: Duration = Duration::from_secs(5);

/// Zwischenspeicher für die eingefügten Tags – jede Seite (und jedes iframe) würde
/// sonst den Mod-Ordner samt Änderungszeiten neu einlesen.
#[derive(Clone, Default)]
pub struct BootCache(Arc<Mutex<Option<Cached>>>);

/// Fertige Tags und wann sie erzeugt wurden.
type Cached = (Instant, Arc<str>);

impl BootCache {
    pub async fn tags(&self, store: &ModStore) -> Arc<str> {
        let mut slot = self.0.lock().await;
        if let Some((_, tags)) = slot.as_ref().filter(|(at, _)| at.elapsed() < CACHE_TTL) {
            return tags.clone();
        }
        let store = store.clone();
        let tags: Arc<str> = match tokio::task::spawn_blocking(move || head_tags(&store.active())).await {
            Ok(tags) => tags.into(),
            Err(_) => loader_tag().into(),
        };
        *slot = Some((Instant::now(), tags.clone()));
        tags
    }

    pub async fn invalidate(&self) {
        *self.0.lock().await = None;
    }
}

/// Alles, was vor `</head>` eingefügt wird: Startdaten, Preload-Hinweise und der Loader.
pub fn head_tags(mods: &[ModInfo]) -> String {
    let v = encode_component(crate::VERSION);
    let mut out = String::new();

    let boot = script_json(&json!({ "version": crate::VERSION, "mods": mods }));
    out.push_str(&format!(
        r#"<script type="application/json" id="zimaforge-boot">{boot}</script>"#
    ));

    out.push_str(&format!(
        r#"<link rel="modulepreload" href="/_forge/runtime/store.js?v={v}">"#
    ));
    for m in mods {
        let rev = encode_component(&format!("{}-{}", m.version, m.rev));
        let url = |rel: &str| {
            let rel = rel.trim_start_matches('/');
            escape_attr(&format!("/_forge/mods/{}/{rel}?v={rev}", encode_component(&m.id)))
        };
        for style in &m.styles {
            out.push_str(&format!(r#"<link rel="preload" as="style" href="{}">"#, url(style)));
        }
        for script in &m.scripts {
            if m.module {
                out.push_str(&format!(r#"<link rel="modulepreload" href="{}">"#, url(script)));
            } else {
                out.push_str(&format!(r#"<link rel="preload" as="script" href="{}">"#, url(script)));
            }
        }
    }

    out.push_str(&loader_tag());
    out
}

/// JSON für ein `<script>`-Element: Es darf kein „</script>“ entstehen, daher
/// <, > und & als JSON-Escapes (Manifeste stammen auch von Dritt-Mods).
fn script_json(value: &Value) -> String {
    value
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
}

/// Wie `encodeURIComponent` in JavaScript – die URLs müssen exakt denen des Loaders gleichen.
fn encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_javascript() {
        assert_eq!(encode_component("2.5.3-1794918452"), "2.5.3-1794918452");
        assert_eq!(encode_component("1.0.0+build"), "1.0.0%2Bbuild");
        assert_eq!(encode_component("ä b"), "%C3%A4%20b");
    }

    #[test]
    fn boot_json_cannot_close_the_script() {
        let evil = json!({ "description": "</script><script>alert(1)</script>" });
        let escaped = script_json(&evil);
        assert!(!escaped.contains('<'), "{escaped}");
        assert_eq!(serde_json::from_str::<Value>(&escaped).unwrap(), evil);

        let html = head_tags(&[]);
        assert_eq!(html.matches("</script>").count(), 2, "Boot-Block und Loader: {html}");
        assert!(html.contains(r#"id="zimaforge-boot""#));
        assert!(html.contains("/_forge/runtime/store.js?v="));
        assert!(!html.contains("config"), "keine Einstellungen in der Seite");
    }
}
