mod aws;
mod commands;
mod credentials;
mod error;
mod events;
mod json_store;
mod paths;
mod reqprep;
mod serial_xfer;
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
        .on_window_event(|window, event| match window.label() {
            // 設定視窗為靜態單例：關閉時改為隱藏，避免被銷毀後 open_settings 永遠找不到它。
            "settings" => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // 關閉主視窗即結束整個程序（含被隱藏、永不銷毀的 settings 視窗），
            // 否則隱藏視窗會讓「所有視窗皆關閉」條件永遠不成立、程序殘留。
            // 先樹狀殺掉任何進行中的子程序（例如 PerfTest 跑的 k6），
            // 否則 Windows 下父程序退出不會自動清理子程序。
            "main" => {
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
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::get_platform,
            commands::system::get_process_env,
            commands::window::open_settings,
            commands::window::quit_app,
            commands::config::load_config,
            commands::config::save_config,
            commands::config::save_visible_pages,
            commands::config::load_visible_pages,
            commands::config::clear_caches,
            commands::config::get_api_credential_configs,
            commands::config::set_api_credential_configs,
            commands::store::save_user_data,
            commands::store::load_user_data,
            commands::store::save_filter_model,
            commands::store::load_filter_model,
            commands::store::save_selection_model,
            commands::store::load_selection_model,
            commands::store::save_api_test_state,
            commands::store::load_api_test_state,
            commands::fsops::read_directory,
            commands::fsops::find_hex_file,
            commands::fsops::read_file_content,
            commands::fsops::write_temp_text,
            commands::fsops::cleanup_temp_file,
            commands::fsops::get_k6_path,
            commands::certs::scan_certificates,
            commands::certs::get_certificates_path,
            commands::certs::get_selected_certificate,
            commands::flash::update_flash_path_data,
            commands::flash::get_flash_path_data,
            commands::process::run_command,
            commands::process::run_program,
            commands::process::stop_command,
            commands::postman::get_postman_collection_path,
            commands::postman::scan_postman_collections,
            commands::postman::load_cached_postman_collections,
            commands::postman::save_postman_collection,
            commands::api::execute_postman_request,
            commands::serial::list_serial_ports,
            commands::serial::configure_serial_port,
            commands::serial::open_serial_port,
            commands::serial::close_serial_port,
            commands::serial::send_serial_data,
            commands::serial::start_serial_listening,
            commands::serial::send_file_serial,
            commands::serial::receive_file_serial,
            commands::network::test_ssh_connection,
            commands::network::scan_network_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
