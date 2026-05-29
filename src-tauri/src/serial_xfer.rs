//! 序列檔案下載的純解析/解碼/指令建構（receive-file-xmodem 單檔路徑）。
//! 消費者為階段 4b-2+ 的 commands/serial.rs 編排。對齊 Electron receiveSingleFileSerial。
//! 修正 spec §7 bug #6：先解碼再驗證解碼後長度。
#![allow(dead_code)]

use base64::Engine;
use regex::Regex;

const BIN_MARKER: &str = "Binary file detected, encoding...";

const TEXT_EXTS: &[&str] = &[
    ".txt", ".log", ".conf", ".cfg", ".json", ".xml", ".html", ".css", ".js", ".sh", ".py", ".md",
    ".yml", ".yaml",
];

/// 依檔名判定是否「可能是文字」（對齊 Electron）。
pub fn is_likely_text(remote_path: &str) -> bool {
    let file_name = remote_path.rsplit('/').next().unwrap_or(remote_path);
    let lower = file_name.to_lowercase();
    TEXT_EXTS.iter().any(|e| lower.ends_with(e)) || !file_name.contains('.')
}

/// 建構接收指令（含換行）。對齊 Electron 的兩種模板。
pub fn build_receive_command(remote_path: &str, is_text: bool) -> String {
    if is_text {
        format!(
            "echo \"=== FILE_START ===\" && wc -c \"{p}\" && echo \"=== CONTENT_START ===\" && cat \"{p}\" && echo \"=== FILE_END ===\"\n",
            p = remote_path
        )
    } else {
        format!(
            "echo \"=== FILE_START ===\" && wc -c \"{p}\" && echo \"=== CONTENT_START ===\" && echo \"Binary file detected, encoding...\" && base64 \"{p}\" && echo \"=== FILE_END ===\"\n",
            p = remote_path
        )
    }
}

#[derive(Debug, PartialEq)]
pub struct ParsedContent {
    pub content: String,
    pub expected_size: Option<usize>,
}

/// 解析接收回應（對齊 Electron processResponse 的標記掃描 + 錯誤偵測）。
pub fn parse_file_response(response: &str, remote_path: &str) -> Result<ParsedContent, String> {
    if response.contains("Permission denied") {
        return Err("Permission denied".into());
    }
    if response.contains("Is a directory") {
        return Err("Path is a directory".into());
    }
    if response.contains("No such file") || response.contains("cannot open") {
        return Err("File not found".into());
    }

    let size_re = Regex::new(r"^\s*(\d+)\s+").unwrap();
    let cat_q = format!("cat \"{remote_path}\"");
    let cat_p = format!("cat {remote_path}");

    let mut clean = String::new();
    let mut in_content = false;
    let mut expected_size: Option<usize> = None;
    let mut file_start = false;
    let mut content_start = false;

    for line in response.split('\n') {
        if !file_start && line.contains("=== FILE_START ===") {
            file_start = true;
            continue;
        }
        if file_start && expected_size.is_none() && size_re.is_match(line) {
            if let Some(c) = size_re.captures(line) {
                expected_size = c[1].parse().ok();
            }
            continue;
        }
        if file_start && !content_start && line.contains("=== CONTENT_START ===") {
            content_start = true;
            in_content = true;
            continue;
        }
        if content_start && line.contains("=== FILE_END ===") {
            break;
        }
        if !in_content
            && (line.contains(&cat_q)
                || line.contains(&cat_p)
                || line.contains("base64")
                || line.contains("Binary file detected")
                || line.contains("wc -c"))
        {
            continue;
        }
        if in_content && (line == "# " || line == "$ " || line.ends_with("# ") || line.ends_with("$ ")) {
            break;
        }
        if in_content {
            if !clean.is_empty() {
                clean.push('\n');
            }
            clean.push_str(line);
        }
    }

    if !file_start || !content_start {
        return Err("File transfer incomplete - missing markers".into());
    }
    Ok(ParsedContent { content: clean, expected_size })
}

#[derive(Debug, PartialEq)]
pub struct Finalized {
    pub bytes: Vec<u8>,
    pub verified: Option<bool>,
}

/// 把解析出的內容轉成要寫檔的位元組。**修 bug #6**：二進位先解碼再驗證解碼後長度。
pub fn finalize(content: &str, expected_size: Option<usize>) -> Result<Finalized, String> {
    if content.contains(BIN_MARKER) {
        // 裝置的 base64 輸出常換行（~76 欄），且 parser 以 \n 接合。Node 的 Buffer.from
        // 會忽略換行，但 Rust 的 STANDARD.decode 會拒絕內嵌空白 → 先去掉所有 ASCII 空白。
        let b64: String = content
            .replace(BIN_MARKER, "")
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .map_err(|_| "Failed to decode base64".to_string())?;
        let verified = expected_size.map(|e| bytes.len() == e);
        Ok(Finalized { bytes, verified })
    } else {
        if let Some(e) = expected_size {
            let got = content.len();
            let diff = (got as f64 - e as f64).abs();
            if diff > e as f64 * 0.1 {
                return Err(format!("File size mismatch: expected {e} bytes, got {got} bytes"));
            }
        }
        let verified = expected_size.map(|e| (content.len() as f64 - e as f64).abs() <= e as f64 * 0.1);
        Ok(Finalized { bytes: content.as_bytes().to_vec(), verified })
    }
}

/// 單引號跳脫（對齊 Electron replace(/'/g, "'\"'\"'")）。
pub fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\"'\"'")
}

/// 計算送檔最終目的地（對齊 Electron：目錄則補檔名）。
pub fn compute_send_dest(dest_path: &str, file_name: &str) -> String {
    if dest_path.ends_with('/') {
        format!("{dest_path}{file_name}")
    } else if !dest_path.contains('.') && !dest_path.contains(file_name) {
        format!("{dest_path}/{file_name}")
    } else {
        dest_path.to_string()
    }
}

/// com_cat 資料夾名（對齊 Electron：先 replace(/[:.]/g,'-') 再 replace('T','_')
/// 再 split('.')[0]——此時已無 '.'，故毫秒與 Z 都保留）。
pub fn com_cat_folder_name(iso_now: &str) -> String {
    let replaced: String = iso_now
        .chars()
        .map(|c| match c {
            ':' | '.' => '-',
            'T' => '_',
            _ => c,
        })
        .collect();
    format!("com_cat_{}", replaced.split('.').next().unwrap_or(&replaced))
}

/// 解析 `ls -l` 輸出 → (檔名, 是否為目錄) 清單（對齊 Electron receiveDirectorySerial 的解析）。
pub fn parse_ls_output(response: &str) -> Vec<(String, bool)> {
    let ansi = Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    let ansi_partial = Regex::new(r"\[[\d;]*m").unwrap();
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in response.split('\n') {
        let t = line.trim();
        let t = ansi.replace_all(t, "");
        let t = ansi_partial.replace_all(&t, "");
        let t = t.as_ref();
        if t.is_empty()
            || t.contains("cd ")
            || t.contains("ls ")
            || t.contains("# ")
            || t.contains("$ ")
            || t.starts_with("total ")
        {
            continue;
        }
        let is_file = t.starts_with('-');
        let is_dir = t.starts_with('d');
        if !(is_file || is_dir) {
            continue;
        }
        let parts: Vec<&str> = t.split_whitespace().collect();
        // 需 >=9 欄才有檔名（Electron 用 >=8 判列、>=9 取檔名；此處合併為 >=9，勿改回 8）。
        if parts.len() < 9 {
            continue;
        }
        let filename = parts[8..].join(" ");
        if filename.is_empty() || filename == "." || filename == ".." {
            continue;
        }
        if is_file {
            if filename == "btmp" || filename == "wtmp" || !filename.contains('.') {
                continue;
            }
            if seen.insert(filename.clone()) {
                out.push((filename, false));
            }
        } else {
            if filename == "private" || filename == "journal" {
                continue;
            }
            if seen.insert(filename.clone()) {
                out.push((filename, true));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn likely_text_by_extension_or_no_dot() {
        assert!(is_likely_text("/a/b/config.json"));
        assert!(is_likely_text("/a/b/README"));
        assert!(!is_likely_text("/a/b/firmware.bin"));
        assert!(!is_likely_text("/a/b/image.png"));
    }

    #[test]
    fn receive_command_templates() {
        let t = build_receive_command("/etc/hosts", true);
        assert!(t.contains("cat \"/etc/hosts\""));
        assert!(t.starts_with("echo \"=== FILE_START ===\""));
        assert!(t.ends_with("\n"));
        let b = build_receive_command("/f.bin", false);
        assert!(b.contains("base64 \"/f.bin\""));
        assert!(b.contains("Binary file detected, encoding..."));
    }

    #[test]
    fn parse_text_response() {
        let resp = "cat \"/etc/x\"\n=== FILE_START ===\n5 /etc/x\n=== CONTENT_START ===\nhello\n=== FILE_END ===\n# ";
        let p = parse_file_response(resp, "/etc/x").unwrap();
        assert_eq!(p.content, "hello");
        assert_eq!(p.expected_size, Some(5));
    }

    #[test]
    fn parse_binary_response_keeps_marker() {
        let resp = "=== FILE_START ===\n5 /f.bin\n=== CONTENT_START ===\nBinary file detected, encoding...\nSGVsbG8=\n=== FILE_END ===\n# ";
        let p = parse_file_response(resp, "/f.bin").unwrap();
        assert!(p.content.contains("Binary file detected, encoding..."));
        assert!(p.content.contains("SGVsbG8="));
        assert_eq!(p.expected_size, Some(5));
    }

    #[test]
    fn parse_device_errors() {
        assert_eq!(parse_file_response("cat: x: No such file or directory\n# ", "x").unwrap_err(), "File not found");
        assert_eq!(parse_file_response("Permission denied\n# ", "x").unwrap_err(), "Permission denied");
        assert_eq!(parse_file_response("Is a directory\n# ", "x").unwrap_err(), "Path is a directory");
    }

    #[test]
    fn parse_incomplete_markers() {
        assert_eq!(parse_file_response("some noise\n# ", "x").unwrap_err(), "File transfer incomplete - missing markers");
    }

    #[test]
    fn finalize_binary_decodes_then_verifies() {
        let content = "Binary file detected, encoding...\nSGVsbG8=";
        let f = finalize(content, Some(5)).unwrap();
        assert_eq!(f.bytes, b"Hello");
        assert_eq!(f.verified, Some(true));
    }

    #[test]
    fn finalize_binary_multiline_base64() {
        // 裝置 base64 換行輸出：去空白後 SGVs+bG8= = SGVsbG8= → "Hello"
        let content = "Binary file detected, encoding...\nSGVs\nbG8=\n";
        let f = finalize(content, Some(5)).unwrap();
        assert_eq!(f.bytes, b"Hello");
        assert_eq!(f.verified, Some(true));
    }

    #[test]
    fn finalize_text_within_tolerance() {
        let f = finalize("hello", Some(5)).unwrap();
        assert_eq!(f.bytes, b"hello");
        assert_eq!(f.verified, Some(true));
    }

    #[test]
    fn finalize_text_size_mismatch_errors() {
        let e = finalize("hello world!!!", Some(5)).unwrap_err();
        assert!(e.contains("File size mismatch"));
    }

    #[test]
    fn escape_quotes() {
        assert_eq!(escape_single_quotes("a'b"), "a'\"'\"'b");
    }

    #[test]
    fn send_dest_dir_vs_file() {
        assert_eq!(compute_send_dest("/tmp/", "f.txt"), "/tmp/f.txt");
        assert_eq!(compute_send_dest("/tmp/data", "f.txt"), "/tmp/data/f.txt"); // 無 . 視為目錄
        assert_eq!(compute_send_dest("/tmp/out.bin", "f.txt"), "/tmp/out.bin"); // 有 . 視為檔
    }

    #[test]
    fn com_cat_name_format() {
        // 對齊 Electron：毫秒與 Z 都保留（: . → -，T → _）。
        assert_eq!(com_cat_folder_name("2026-05-28T12:34:56.789Z"), "com_cat_2026-05-28_12-34-56-789Z");
    }

    #[test]
    fn parse_ls_files_and_dirs() {
        let resp = "cd \"/data\" && ls -l\n\
total 12\n\
-rw-r--r-- 1 root root  100 Jan  1 00:00 config.json\n\
drwxr-xr-x 2 root root 4096 Jan  1 00:00 logs\n\
-rw-r--r-- 1 root root   50 Jan  1 00:00 noext\n\
-rw-r--r-- 1 root root   10 Jan  1 00:00 btmp\n\
drwxr-xr-x 2 root root 4096 Jan  1 00:00 private\n\
# ";
        let items = parse_ls_output(resp);
        assert_eq!(items, vec![("config.json".to_string(), false), ("logs".to_string(), true)]);
    }

    #[test]
    fn parse_ls_dedups_by_name() {
        let resp = "total 1\n-rw-r--r-- 1 a a 1 Jan 1 00:00 a.txt\n-rw-r--r-- 1 a a 1 Jan 1 00:00 a.txt\n# ";
        assert_eq!(parse_ls_output(resp), vec![("a.txt".to_string(), false)]);
    }

    #[test]
    fn parse_ls_empty_on_no_listing() {
        assert!(parse_ls_output("# ").is_empty());
    }
}
