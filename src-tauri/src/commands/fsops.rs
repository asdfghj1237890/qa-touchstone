use crate::error::{AppError, AppResult};
use tauri::Manager;
use tauri::path::BaseDirectory;

fn rejects_traversal(p: &str) -> bool {
    p.is_empty() || p.contains("..")
}

#[tauri::command]
pub fn read_directory(folder_path: String) -> Vec<String> {
    if rejects_traversal(&folder_path) {
        return Vec::new();
    }
    match std::fs::read_dir(&folder_path) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect(),
        Err(_) => Vec::new(), // 對齊 Electron：錯誤回 []
    }
}

#[tauri::command]
pub fn find_hex_file(folder_path: String) -> Option<String> {
    if rejects_traversal(&folder_path) {
        return None;
    }
    let entries = std::fs::read_dir(&folder_path).ok()?;
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
    // 阻擋目錄穿越（對齊 Electron 的 includes('..') 檢查）
    if file_path.contains("..") {
        return Err(AppError::Other("Access to the path is restricted.".into()));
    }
    std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Other(format!("Failed to read file: {e}")))
}

/// Resolve the absolute path of the bundled `k6.exe` (listed under
/// `bundle.resources` in tauri.conf.json). Works in both dev and prod since
/// Tauri's path resolver returns the correct location either way.
#[tauri::command]
pub fn get_k6_path(app: tauri::AppHandle) -> AppResult<String> {
    let p = app
        .path()
        .resolve("resources/k6.exe", BaseDirectory::Resource)
        .map_err(|e| AppError::Other(format!("Resolve k6 path failed: {e}")))?;
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
    let temp = std::env::temp_dir();
    let canon_p = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
    let canon_t = std::fs::canonicalize(&temp).unwrap_or_else(|_| temp.clone());
    if !canon_p.starts_with(&canon_t) {
        return Err(AppError::Other("Refusing to delete outside the temp dir".into()));
    }
    std::fs::remove_file(&p)
        .map_err(|e| AppError::Other(format!("Remove failed: {e}")))?;
    Ok(())
}

/// Write `content` to a uniquely-named file in the OS temp dir and return its
/// absolute path. Used to hand a generated script (e.g. for `k6 run`) to a
/// subprocess invoked via `run_command`.
#[tauri::command]
pub fn write_temp_text(content: String, suffix: Option<String>) -> AppResult<String> {
    use std::io::Write;
    let suffix = suffix.unwrap_or_else(|| "txt".into());
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
    fn write_temp_text_roundtrip() {
        let path = write_temp_text("hello k6\n".into(), Some("js".into())).unwrap();
        assert!(path.ends_with(".js"));
        let back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(back, "hello k6\n");
        std::fs::remove_file(&path).ok();
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
