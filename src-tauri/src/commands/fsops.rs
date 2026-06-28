use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;

const MAX_UPDATE_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;

fn canonical_temp_dir() -> Option<PathBuf> {
    std::fs::canonicalize(std::env::temp_dir()).ok()
}

fn clean_suffix(suffix: Option<String>) -> String {
    let raw = suffix.unwrap_or_else(|| "txt".into());
    let mut cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();
    if cleaned.is_empty() {
        cleaned = "txt".into();
    }
    cleaned
}

/// Resolve the bundled k6 binary the perf runner should launch.
///
/// Each platform bundles its own binary under `bundle.resources` (see
/// tauri.windows.conf.json → `resources/k6.exe`, tauri.macos.conf.json →
/// `resources/k6`). Tauri's resolver returns the correct location in both dev
/// and prod. If the bundled binary is missing, this errors so the renderer
/// falls back to a system-installed `k6` on PATH (`k6Path || 'k6'` in
/// PerfTest.jsx).
#[tauri::command]
pub fn get_k6_path(app: tauri::AppHandle) -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let rel = "resources/k6.exe";
    #[cfg(not(target_os = "windows"))]
    let rel = "resources/k6";

    let p = app
        .path()
        .resolve(rel, BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("Resolve k6 path failed: {e}")))?;
    if !p.exists() {
        return Err(AppError::Other(format!(
            "Bundled k6 not found at {}; falling back to PATH",
            p.display()
        )));
    }
    p.to_str()
        .map(String::from)
        .ok_or_else(|| AppError::Other("k6 path is not valid UTF-8".into()))
}

/// Delete a file the renderer earlier received from `write_temp_text`. The
/// path is validated to live under the OS temp dir to refuse arbitrary deletes.
#[tauri::command]
pub fn cleanup_temp_file(path: String) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::Other("Empty path".into()));
    }
    let p = std::path::PathBuf::from(&path);
    let canon_p = std::fs::canonicalize(&p)
        .map_err(|e| AppError::Other(format!("Invalid temp file path: {e}")))?;
    let Some(canon_t) = canonical_temp_dir() else {
        return Err(AppError::Other("Temp dir is unavailable".into()));
    };
    if !canon_p.starts_with(&canon_t) {
        return Err(AppError::Other(
            "Refusing to delete outside the temp dir".into(),
        ));
    }
    std::fs::remove_file(&p).map_err(|e| AppError::Other(format!("Remove failed: {e}")))?;
    Ok(())
}

/// Write `content` to a uniquely-named file in the OS temp dir and return its
/// absolute path. Used to hand a generated script (e.g. for `k6 run`) to a
/// subprocess invoked via the k6 runner.
#[tauri::command]
pub fn write_temp_text(content: String, suffix: Option<String>) -> AppResult<String> {
    use std::io::Write;
    let suffix = clean_suffix(suffix);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let path = std::env::temp_dir().join(format!("qa-{pid}-{nanos}.{suffix}"));
    let mut f = std::fs::File::create(&path)
        .map_err(|e| AppError::Other(format!("Create temp file failed: {e}")))?;
    f.write_all(content.as_bytes())
        .map_err(|e| AppError::Other(format!("Write temp file failed: {e}")))?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("Temp path is not valid UTF-8".into()))
}

/// Write `contents` to an absolute `path` the user picked via the native save
/// dialog. The renderer's blob `<a download>` does not trigger a save in the
/// Tauri WebView, so exports (perf reports, security JSON/HTML/JUnit/SARIF,
/// docs, collections) route here instead. The path is user-chosen through the
/// OS dialog, so this is not a renderer-controlled arbitrary write; we only
/// reject an empty path.
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::Other("No save path provided.".into()));
    }
    std::fs::write(&path, contents.as_bytes())
        .map_err(|e| AppError::Other(format!("Save failed: {e}")))?;
    Ok(())
}

fn is_allowed_update_download_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    host == "github.com" && url.path().contains("/releases/download/")
}

/// Download an app update asset to a user-chosen path. The renderer chooses the
/// path via the native save dialog first; this command only accepts GitHub
/// release-asset URLs so it cannot be reused as a general arbitrary downloader.
#[tauri::command]
pub async fn download_update_asset(url: String, path: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::Other("No save path provided.".into()));
    }
    if !is_allowed_update_download_url(&url) {
        return Err(AppError::Other(
            "Refusing to download a non-GitHub release asset.".into(),
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent("QA Touchstone updater")
        .build()
        .map_err(|e| AppError::Other(format!("Create download client failed: {e}")))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "Download failed with HTTP {}",
            resp.status()
        )));
    }
    if let Some(len) = resp.content_length() {
        if len > MAX_UPDATE_DOWNLOAD_BYTES {
            return Err(AppError::Other("Update asset is too large.".into()));
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("Read download failed: {e}")))?;
    if bytes.len() as u64 > MAX_UPDATE_DOWNLOAD_BYTES {
        return Err(AppError::Other("Update asset is too large.".into()));
    }
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::Other(format!("Save failed: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_text_file_writes_chosen_path() {
        let p = std::env::temp_dir().join(format!("qa-save-{}.txt", std::process::id()));
        let ps = p.to_string_lossy().to_string();
        save_text_file(ps.clone(), "report-body\n".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "report-body\n");
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn save_text_file_rejects_empty_path() {
        assert!(save_text_file("   ".into(), "x".into()).is_err());
    }

    #[test]
    fn update_download_url_must_be_github_release_asset() {
        assert!(is_allowed_update_download_url(
            "https://github.com/asdfghj1237890/qa-touchstone/releases/download/v0.23.0/app.dmg"
        ));
        assert!(!is_allowed_update_download_url(
            "https://example.com/asdfghj1237890/qa-touchstone/releases/download/v0.23.0/app.dmg"
        ));
        assert!(!is_allowed_update_download_url(
            "http://github.com/asdfghj1237890/qa-touchstone/releases/download/v0.23.0/app.dmg"
        ));
        assert!(!is_allowed_update_download_url(
            "https://github.com/asdfghj1237890/qa-touchstone/archive/refs/tags/v0.23.0.zip"
        ));
    }

    #[test]
    fn write_temp_text_roundtrip() {
        let path = write_temp_text("hello k6\n".into(), Some("js".into())).unwrap();
        assert!(path.ends_with(".js"));
        let back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(back, "hello k6\n");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn write_temp_text_sanitizes_suffix() {
        let path = write_temp_text("x".into(), Some("../bad/js".into())).unwrap();
        assert!(path.ends_with(".badjs"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn cleanup_temp_file_deletes_under_temp() {
        let path = write_temp_text("x".into(), Some("tmp".into())).unwrap();
        assert!(std::path::Path::new(&path).exists());
        cleanup_temp_file(path.clone()).unwrap();
        assert!(!std::path::Path::new(&path).exists());
    }

    #[test]
    fn cleanup_temp_file_refuses_outside_temp() {
        // The repo root is definitely not under the OS temp dir.
        let cwd = std::env::current_dir().unwrap();
        let r = cleanup_temp_file(cwd.join("Cargo.toml").to_string_lossy().to_string());
        assert!(r.is_err());
    }
}
