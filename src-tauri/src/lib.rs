mod commands;
mod credentials;
mod error;
mod events;
mod json_store;
mod paths;
mod secrets;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 對齊 Electron 的 process.on('uncaughtException') —— 記錄 panic。
    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}");
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .on_window_event(|window, event| {
            // 關閉主視窗即結束整個程序。
            // 先樹狀殺掉任何進行中的子程序（例如 PerfTest 跑的 k6），
            // 否則 Windows 下父程序退出不會自動清理子程序。
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let app = window.app_handle();
                    if let Some(state) = app.try_state::<AppState>() {
                        let pid_opt = state.current_process_pid.lock().take();
                        if let Some(pid) = pid_opt {
                            commands::process::kill_tree(pid);
                        }
                    }
                    app.exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_platform,
            commands::system::get_process_env,
            commands::ai_policy::get_ai_policy,
            commands::window::quit_app,
            commands::config::load_config,
            commands::config::save_config,
            commands::config::get_api_credential_configs,
            commands::config::set_api_credential_configs,
            commands::secrets::set_aws_secret,
            commands::secrets::has_aws_secret,
            commands::secrets::delete_aws_secret,
            commands::store::save_user_data,
            commands::store::load_user_data,
            commands::fsops::write_temp_text,
            commands::fsops::cleanup_temp_file,
            commands::fsops::get_k6_path,
            commands::fsops::save_text_file,
            commands::fsops::download_update_asset,
            commands::process::run_k6,
            commands::process::stop_command,
            commands::postman::get_postman_collection_path,
            commands::postman::scan_postman_collections,
            commands::postman::load_cached_postman_collections,
            commands::postman::save_postman_collection,
            commands::api::execute_postman_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
