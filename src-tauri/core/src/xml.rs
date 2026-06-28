//! Shared XML helpers for the JUnit reporters (run + security). Each input is already
//! redacted by the caller; here we only make it XML-safe.

/// Replace characters not permitted in XML 1.0 (NUL/most C0 controls, U+FFFE/FFFF) with
/// U+FFFD. Tab/newline/CR are allowed. (Rust `String` is valid UTF-8, so lone surrogates
/// can't occur — only forbidden controls + U+FFFE/FFFF need stripping.)
pub fn sanitize_xml(s: &str) -> String {
    s.chars()
        .map(|c| {
            let u = c as u32;
            if c == '\t' || c == '\n' || c == '\r' {
                c
            } else if u < 0x20 || u == 0xFFFE || u == 0xFFFF {
                '\u{FFFD}'
            } else {
                c
            }
        })
        .collect()
}

/// Escape for an XML attribute value (sanitize first; `&` replaced first).
pub fn xml_attr_escape(s: &str) -> String {
    sanitize_xml(s)
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanitize_strips_controls_keeps_ws() {
        assert_eq!(sanitize_xml("a\u{0}\u{7}b\tc\n"), "a\u{FFFD}\u{FFFD}b\tc\n");
        assert_eq!(sanitize_xml("a\u{FFFF}b"), "a\u{FFFD}b");
    }
    #[test]
    fn attr_escapes_metachars_after_sanitize() {
        assert_eq!(
            xml_attr_escape("a<b>&\"'\u{0}"),
            "a&lt;b&gt;&amp;&quot;&apos;\u{FFFD}"
        );
    }
}
