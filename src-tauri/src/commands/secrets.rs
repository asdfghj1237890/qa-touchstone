// Tauri commands fronting the OS keychain (src/secrets.rs). The renderer stores
// an AWS secret access key here by credential-profile id instead of writing it
// into config.json; resolution at request time reads it back from the keychain.
use crate::commands::config::CommandResult;
use crate::secrets;

#[tauri::command]
pub fn set_aws_secret(id: String, secret: String) -> CommandResult {
    if id.trim().is_empty() {
        return CommandResult::err_pub("Missing credential profile id.".into());
    }
    match secrets::set_secret(&id, &secret) {
        Ok(()) => CommandResult::ok_pub(),
        Err(e) => CommandResult::err_pub(e.to_string()),
    }
}

#[tauri::command]
pub fn has_aws_secret(id: String) -> bool {
    secrets::get_secret(&id).ok().flatten().map(|s| !s.is_empty()).unwrap_or(false)
}

#[tauri::command]
pub fn delete_aws_secret(id: String) -> CommandResult {
    match secrets::delete_secret(&id) {
        Ok(()) => CommandResult::ok_pub(),
        Err(e) => CommandResult::err_pub(e.to_string()),
    }
}
