use serde::Serialize;

#[derive(Serialize)]
pub struct ProcessEnv {
    #[serde(rename = "NODE_ENV")]
    pub node_env: String,
}

/// 回傳平台字串，對齊 Electron 的 process.platform：win32 / darwin / linux。
#[tauri::command]
pub fn get_platform() -> String {
    platform_string().to_string()
}

#[tauri::command]
pub fn get_process_env() -> ProcessEnv {
    let default_env = if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    };
    ProcessEnv {
        node_env: std::env::var("NODE_ENV").unwrap_or_else(|_| default_env.to_string()),
    }
}

fn platform_string() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_matches_current_os() {
        let p = platform_string();
        if cfg!(target_os = "windows") {
            assert_eq!(p, "win32");
        } else if cfg!(target_os = "macos") {
            assert_eq!(p, "darwin");
        } else {
            assert_eq!(p, "linux");
        }
    }
}
