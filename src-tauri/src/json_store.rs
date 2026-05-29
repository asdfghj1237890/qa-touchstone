use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::path::Path;

/// 讀取 JSON 檔為 Value；檔案不存在回 None。
pub fn read_value(path: &Path) -> AppResult<Option<Value>> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(serde_json::from_str(&s)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// 以 pretty JSON 寫檔（2 空格縮排，對齊 Electron 的 JSON.stringify(x,null,2)）。
pub fn write_pretty(path: &Path, value: &Value) -> AppResult<()> {
    let s = serde_json::to_string_pretty(value)?;
    std::fs::write(path, s)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_reads_none() {
        let dir = std::env::temp_dir().join(format!("jsdiag_{}", std::process::id()));
        let p = dir.join("nope.json");
        assert!(read_value(&p).unwrap().is_none());
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = std::env::temp_dir().join(format!("jsrt_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x.json");
        write_pretty(&p, &json!({"a":1,"b":[2,3]})).unwrap();
        let v = read_value(&p).unwrap().unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"][1], 3);
        std::fs::remove_dir_all(&dir).ok();
    }
}
