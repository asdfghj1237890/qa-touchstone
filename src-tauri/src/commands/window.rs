use tauri::Manager;

/// 顯示（或聚焦）設定視窗。設定視窗在 tauri.conf.json 以 visible:false 靜態定義，
/// 啟動時即建立並載入 dev server（與主視窗相同），身分由 window label ("settings") 判定。
/// 這樣避免執行時 WebviewUrl::App 在 dev 模式下不走 dev server 而顯示空白頁的問題。
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window not found".to_string())?;
    win.show().map_err(|e| e.to_string())?;
    win.unminimize().ok();
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
