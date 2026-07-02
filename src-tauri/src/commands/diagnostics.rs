use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 「匯出診斷資料」讀取 log 尾段的上限：256 KiB。
pub const MAX_LOG_TAIL_BYTES: usize = 256 * 1024;

/// 在 `dir` 裡找最新的 `.log` 檔（依 mtime；同 mtime 以檔名 tiebreak）。
/// 目錄不存在 / 讀不到 / 沒有 .log 檔一律回 None。
fn newest_log_file(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_log = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("log"));
        if !is_log || !path.is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        // tuple 比較：先 mtime，再路徑（同目錄下等於檔名 tiebreak，保證確定性）。
        let candidate = (modified, path);
        if best.as_ref().map_or(true, |b| candidate > *b) {
            best = Some(candidate);
        }
    }
    best.map(|(_, path)| path)
}

/// 讀 `path` 的最後 `cap` bytes，UTF-8 lossy 轉字串（切到多位元組字元中間
/// 以 U+FFFD 呈現，不會 panic）。
fn tail_log_file(path: &Path, cap: usize) -> AppResult<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    if len > cap as u64 {
        file.seek(SeekFrom::End(-(cap as i64)))?;
    }
    let mut buf = Vec::with_capacity(len.min(cap as u64) as usize);
    file.read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// 讀 app log dir（tauri_plugin_log 的 LogDir target 寫入處）中最新 .log 檔
/// 的尾段，給前端「匯出診斷資料」報告用。不收任何參數 —— renderer 無法指定
/// 路徑，讀取面固定在 app_log_dir。
#[tauri::command]
pub fn read_app_logs(app: tauri::AppHandle) -> AppResult<String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::Other(format!("Resolve app log dir failed: {e}")))?;
    let newest = newest_log_file(&dir)
        .ok_or_else(|| AppError::Other("No .log file found in the app log dir yet.".into()))?;
    tail_log_file(&newest, MAX_LOG_TAIL_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::{Duration, SystemTime};

    /// 測試專用暫存目錄；Drop 時整棵清掉。
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("qa-diag-{}-{}", std::process::id(), tag));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(dir: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, contents).unwrap();
        p
    }

    fn set_mtime(p: &Path, t: SystemTime) {
        let f = File::options().write(true).open(p).unwrap();
        f.set_modified(t).unwrap();
    }

    #[test]
    fn max_tail_cap_is_256_kib() {
        assert_eq!(MAX_LOG_TAIL_BYTES, 262_144);
    }

    #[test]
    fn tail_returns_small_file_whole() {
        let d = TempDir::new("tail-small");
        let p = write(d.path(), "app.log", b"INFO boot\nWARN disk\n");
        assert_eq!(
            tail_log_file(&p, MAX_LOG_TAIL_BYTES).unwrap(),
            "INFO boot\nWARN disk\n"
        );
    }

    #[test]
    fn tail_caps_to_last_bytes() {
        let d = TempDir::new("tail-cap");
        let p = write(d.path(), "app.log", b"0123456789abcdefghij12345");
        assert_eq!(tail_log_file(&p, 10).unwrap(), "fghij12345");
    }

    #[test]
    fn tail_is_lossy_when_cap_splits_a_multibyte_char() {
        let d = TempDir::new("tail-lossy");
        // 'é' = [0xC3, 0xA9]；cap=3 會從第二個 byte 切入 → U+FFFD + "ab"。
        let p = write(d.path(), "app.log", &[0xC3, 0xA9, b'a', b'b']);
        assert_eq!(tail_log_file(&p, 3).unwrap(), "\u{FFFD}ab");
    }

    #[test]
    fn tail_errors_on_missing_file() {
        let d = TempDir::new("tail-missing");
        assert!(tail_log_file(&d.path().join("nope.log"), 10).is_err());
    }

    #[test]
    fn newest_log_picks_latest_mtime_and_ignores_non_log_files() {
        let d = TempDir::new("newest");
        let old = write(d.path(), "a.log", b"old");
        let new = write(d.path(), "b.log", b"new");
        let txt = write(d.path(), "c.txt", b"not a log");
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        set_mtime(&old, base);
        set_mtime(&new, base + Duration::from_secs(60));
        set_mtime(&txt, base + Duration::from_secs(120)); // 最新，但不是 .log
        assert_eq!(newest_log_file(d.path()), Some(new.clone()));
        // 反轉 mtime 後改選 a.log —— 證明看的是修改時間，不是檔名或建立順序。
        set_mtime(&old, base + Duration::from_secs(300));
        assert_eq!(newest_log_file(d.path()), Some(old));
    }

    #[test]
    fn newest_log_breaks_mtime_ties_by_name() {
        let d = TempDir::new("newest-tie");
        let a = write(d.path(), "a.log", b"a");
        let b = write(d.path(), "b.log", b"b");
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        set_mtime(&a, t);
        set_mtime(&b, t);
        assert_eq!(newest_log_file(d.path()), Some(b));
    }

    #[test]
    fn newest_log_none_when_dir_has_no_log_files() {
        let d = TempDir::new("newest-none");
        write(d.path(), "notes.txt", b"x");
        assert_eq!(newest_log_file(d.path()), None);
        assert_eq!(newest_log_file(&d.path().join("missing-subdir")), None);
    }
}
