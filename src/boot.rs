//! Startdaten, die mit dem Loader in jede Dashboard-Seite eingefügt werden.
//!
//! Ohne sie wartet der Browser nacheinander auf `/_forge/api/mods`, dann auf die
//! Mod-Dateien, dann auf die Einstellungen jedes Mods. Mit ihnen steht alles schon
//! im HTML, und die Mod-Dateien laden parallel zu ZimaOS (`preload`).

use serde_json::{Map, Value, json};

use crate::mods::{ModInfo, ModStore};
use crate::proxy::loader_tag;

/// Einstellungen von ZimaForge selbst (Launcher, Update-Prüfung).
const CORE_CONFIG_ID: &str = "zimaforge";

/// Liest aktive Mods und ihre Einstellungen (blockierend, im Hintergrund aufrufen).
pub fn collect(store: &ModStore) -> (Vec<ModInfo>, Map<String, Value>) {
    let mods = store.active();
    let mut config = Map::new();
    for id in std::iter::once(CORE_CONFIG_ID).chain(mods.iter().map(|m| m.id.as_str())) {
        if let Ok(value) = store.read_config(id) {
            config.insert(id.to_owned(), value);
        }
    }
    (mods, config)
}

/// Alles, was vor `</head>` eingefügt wird: Startdaten, Preload-Hinweise und der Loader.
pub fn head_tags(mods: &[ModInfo], config: Map<String, Value>) -> String {
    let v = encode_component(crate::VERSION);
    let mut out = String::new();

    let boot = json!({ "version": crate::VERSION, "mods": mods, "config": config });
    // In <script> darf kein „</script>“ entstehen: <, > und & als JSON-Escapes.
    let boot = boot
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
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
        let mut config = Map::new();
        config.insert("x".into(), json!({ "evil": "</script><script>alert(1)</script>" }));
        let html = head_tags(&[], config);
        assert_eq!(
            html.matches("</script>").count(),
            2,
            "nur Boot-Block und Loader schließen: {html}"
        );
        assert!(html.contains(r#"id="zimaforge-boot""#));
        assert!(html.contains("/_forge/runtime/store.js?v="));
    }
}
