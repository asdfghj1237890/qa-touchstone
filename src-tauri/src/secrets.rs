// ── QA Touchstone — OS keychain secret store ────────────────────────────────
// AWS secret access keys used to live in plaintext inside config.json. They now
// live in the OS keychain (Windows Credential Manager / macOS Keychain / Linux
// Secret Service) keyed by the credential profile id; config.json keeps only the
// access key id and a `secretInKeychain` marker. A legacy inline secret is still
// honored on read so existing setups keep working (and can be migrated).
use crate::error::{AppError, AppResult};

const SERVICE: &str = "qa-touchstone-aws";

fn entry(account: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, account).map_err(|e| AppError::Other(format!("keychain: {e}")))
}

pub fn set_secret(account: &str, secret: &str) -> AppResult<()> {
    entry(account)?
        .set_password(secret)
        .map_err(|e| AppError::Other(format!("keychain write failed: {e}")))
}

pub fn get_secret(account: &str) -> AppResult<Option<String>> {
    match entry(account)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("keychain read failed: {e}"))),
    }
}

pub fn delete_secret(account: &str) -> AppResult<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("keychain delete failed: {e}"))),
    }
}

// Pure resolution: an inline (legacy) secret wins; otherwise fall back to whatever
// the keychain returned. Empty strings count as "absent" on both sides. Kept pure
// so the precedence + migration logic is unit-tested without touching the OS store.
pub fn resolve_secret(inline: &str, keychain: Option<String>) -> Option<String> {
    if !inline.is_empty() {
        return Some(inline.to_string());
    }
    keychain.filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The keychain I/O wrappers are thin pass-throughs to the `keyring` crate and
    // are verified at runtime against the real OS store (CI has no Secret Service,
    // and keyring's mock is per-Entry so it can't model a cross-call round-trip).
    // The precedence/migration LOGIC is the part worth pinning down here.
    #[test]
    fn resolve_prefers_inline_then_keychain() {
        assert_eq!(resolve_secret("inline", Some("kc".into())), Some("inline".into())); // legacy inline wins
        assert_eq!(resolve_secret("", Some("kc".into())), Some("kc".into()));           // else keychain
        assert_eq!(resolve_secret("", Some("".into())), None);                          // empty keychain → absent
        assert_eq!(resolve_secret("", None), None);                                     // nothing anywhere
    }
}
