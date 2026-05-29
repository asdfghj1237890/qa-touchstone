use crate::error::{AppError, AppResult};

#[tauri::command]
pub fn read_directory(folder_path: String) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_content_blocks_traversal() {
        let r = read_file_content("../secret.txt".into());
        assert!(r.is_err());
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
