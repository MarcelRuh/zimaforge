//! Einschleusen des ZimaForge-Loaders in HTML-Antworten des Dashboards.

/// Fügt `tag` vor `</head>` ein; fehlt das, vor `</body>`; sonst am Ende.
/// Bereits injizierte Dokumente (Marker vorhanden) bleiben unverändert.
pub fn inject(html: &[u8], tag: &str, marker: &str) -> Vec<u8> {
    if find_ci(html, marker.as_bytes()).is_some() {
        return html.to_vec();
    }
    let at = find_ci(html, b"</head>")
        .or_else(|| find_ci(html, b"</body>"))
        .unwrap_or(html.len());
    let mut out = Vec::with_capacity(html.len() + tag.len());
    out.extend_from_slice(&html[..at]);
    out.extend_from_slice(tag.as_bytes());
    out.extend_from_slice(&html[at..]);
    out
}

/// Groß-/kleinschreibungsunabhängige Suche (ASCII).
fn find_ci(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAG: &str = "<script data-zimaforge></script>";
    const MARK: &str = "data-zimaforge";

    #[test]
    fn before_head_close() {
        let out = inject(b"<html><head><title>x</title></head><body></body></html>", TAG, MARK);
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "<html><head><title>x</title><script data-zimaforge></script></head><body></body></html>"
        );
    }

    #[test]
    fn case_insensitive_and_body_fallback() {
        let out = inject(b"<BODY>hi</BODY>", TAG, MARK);
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "<BODY>hi<script data-zimaforge></script></BODY>"
        );
        let out = inject(b"<HEAD></HEAD>", TAG, MARK);
        assert!(String::from_utf8(out).unwrap().starts_with("<HEAD><script"));
    }

    #[test]
    fn append_when_no_tags() {
        assert_eq!(inject(b"plain", TAG, MARK), format!("plain{TAG}").into_bytes());
    }

    #[test]
    fn idempotent() {
        let once = inject(b"<head></head>", TAG, MARK);
        assert_eq!(inject(&once, TAG, MARK), once);
    }

    #[test]
    fn non_utf8_is_preserved() {
        let input = [0xff, 0xfe, b'<', b'/', b'h', b'e', b'a', b'd', b'>'];
        let out = inject(&input, TAG, MARK);
        assert_eq!(&out[..2], &[0xff, 0xfe]);
        assert!(out.ends_with(b"</head>"));
    }
}
