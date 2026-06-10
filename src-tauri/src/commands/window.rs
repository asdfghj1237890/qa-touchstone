use crate::state::AppState;

/// 自訂標題列（decorations:false）的關閉鈕直接呼叫此指令，繞過
/// `getCurrentWindow().close()` → WindowEvent::CloseRequested 事件鏈，
/// 確保按下 X 一定能結束整個程序。行為對齊 lib.rs 的 "main" CloseRequested
/// handler：先樹狀殺掉進行中的子程序（例如 PerfTest 跑的 k6），再退出。
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: tauri::State<AppState>) {
    let pid_opt = state.current_process_pid.lock().take();
    if let Some(pid) = pid_opt {
        crate::commands::process::kill_tree(pid);
    }
    app.exit(0);
}
