use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 取得 Tauri 自己的 app config 目錄（依 tauri.conf.json 的 identifier 決定）。
/// 路徑與 Electron 的 app.getPath('userData') 不同：依設計 §3 決議 (a)，
/// 遷移後從新開始、不沿用舊 Electron 資料。若不存在則建立。
pub fn config_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// userData 下某個檔案的完整路徑。
pub fn data_file(app: &AppHandle, name: &str) -> std::io::Result<PathBuf> {
    Ok(config_dir(app)?.join(name))
}
