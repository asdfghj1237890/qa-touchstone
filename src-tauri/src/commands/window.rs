use tauri::Manager;

use crate::state::AppState;

/// 自訂標題列（decorations:false）的關閉鈕直接呼叫此指令，繞過
/// `getCurrentWindow().close()` → WindowEvent::CloseRequested 事件鏈，
/// 確保按下 X 一定能結束整個程序。行為對齊 lib.rs 的 "main" CloseRequested
/// handler：先樹狀殺掉進行中的子程序（例如 PerfTest 跑的 k6），再退出，
/// 連帶結束被隱藏、永不銷毀的 settings 視窗。
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: tauri::State<AppState>) {
    let pid_opt = state.current_process_pid.lock().take();
    if let Some(pid) = pid_opt {
        crate::commands::process::kill_tree(pid);
    }
    app.exit(0);
}

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
