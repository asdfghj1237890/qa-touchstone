use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::Manager;

fn canonical_temp_dir() -> Option<PathBuf> {
    std::fs::canonicalize(std::env::temp_dir()).ok()
}

fn canonical_existing_under_temp(path: impl AsRef<Path>) -> Option<PathBuf> {
    let p = std::fs::canonicalize(path).ok()?;
    let temp = canonical_temp_dir()?;
    if p.starts_with(temp) { Some(p) } else { None }
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

#[tauri::command]
pub fn read_directory(folder_path: String) -> Vec<String> {
    let Some(folder) = canonical_existing_under_temp(&folder_path) else {
        return Vec::new();
    };
    match std::fs::read_dir(&folder) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect(),
        Err(_) => Vec::new(), // 對齊 Electron：錯誤回 []
    }
}

#[tauri::command]
pub fn find_hex_file(folder_path: String) -> Option<String> {
    let folder = canonical_existing_under_temp(&folder_path)?;
    let entries = std::fs::read_dir(&folder).ok()?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("hex")) == Some(true) {
            return path.to_str().map(|s| s.to_string());
        }
    }
    None
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> AppResult<String> {
    if file_path.is_empty() {
        return Err(AppError::Other("Invalid file path provided.".into()));
    }
    let Some(path) = canonical_existing_under_temp(&file_path) else {
        return Err(AppError::Other("Access to the path is restricted.".into()));
    };
    std::fs::read_to_string(&path)
        .map_err(|e| AppError::Other(format!("Failed to read file: {e}")))
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
        return Err(AppError::Other("Refusing to delete outside the temp dir".into()));
    }
    std::fs::remove_file(&p)
        .map_err(|e| AppError::Other(format!("Remove failed: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_content_blocks_traversal() {
        let r = read_file_content("../secret.txt".into());
        assert!(r.is_err());
    }

    #[test]
    fn read_file_content_allows_temp_file() {
        let path = write_temp_text("hello\n".into(), Some("txt".into())).unwrap();
        let r = read_file_content(path.clone()).unwrap();
        assert_eq!(r, "hello\n");
        std::fs::remove_file(path).ok();
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

    #[test]
    fn read_directory_blocks_traversal() {
        assert!(read_directory("../etc".into()).is_empty());
    }

    #[test]
    fn read_file_content_rejects_empty() {
        assert!(read_file_content(String::new()).is_err());
    }

    #[test]
    fn find_hex_file_finds_hex() {
        let dir = std::env::temp_dir().join(format!("hexdiag_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("firmware.hex"), "x").unwrap();
        std::fs::write(dir.join("readme.txt"), "y").unwrap();
        let found = find_hex_file(dir.to_str().unwrap().to_string()).unwrap();
        assert!(found.to_lowercase().ends_with(".hex"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_directory_missing_returns_empty() {
        let v = read_directory("/no/such/dir/xyz".into());
        assert!(v.is_empty());
    }
}
