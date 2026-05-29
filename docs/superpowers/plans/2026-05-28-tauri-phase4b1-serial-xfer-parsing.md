# Tauri 遷移 — 階段 4b-1：序列檔案傳輸的純解析/解碼（含修 bug #6，Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把序列檔案下載（receive-file-xmodem 的單檔路徑）中**純函式、可單元測試**的部分先移植並測好：接收回應的標記解析（`=== FILE_START/CONTENT_START/FILE_END ===` + size 行 + 命令回音略過 + 裝置錯誤偵測）、內容 finalize（base64 解碼/文字，**並修正 spec §7 bug #6**：先解碼再驗證解碼後長度，不再用 base64 編碼長度做預檢），以及接收指令字串建構（cat/base64 + markers）與文字/二進位判定。**本階段不接 command、不打序列、不動前端**；I/O 編排（send_file_serial、單檔/目錄接收）留待 4b-2+。

**Architecture:** 新增 `src-tauri/src/serial_xfer.rs`（純函式，crate root，比照 reqprep/aws/credentials）。加 `base64` crate。`#![allow(dead_code)]`（消費者為 4b-2+ 的 commands/serial.rs 編排），以 `#[cfg(test)]` 完整覆蓋。對齊 Electron `receiveSingleFileSerial`（electron.js:3147-3457）的解析（:3201-3325）與接收指令（:3404-3411），bug #6 在 :3271-3295。

**Tech Stack:** Rust（base64、regex、既有 serde_json）。

**⚠️ 驗證界線：** 本模組純函式可完整單元測試（這是 4b 唯一能被機器釘住正確性的部分，尤其 bug #6）。實際序列 I/O 編排留待 4b-2+，且只能在 RFD 實機驗證。

**逐字保留的契約（解析）：**
- 裝置錯誤偵測（順序）：含 `Permission denied` → `"Permission denied"`；含 `Is a directory` → `"Path is a directory"`；含 `No such file`/`cannot open` → `"File not found"`。
- 標記掃描：`=== FILE_START ===` → size 行（`^\s*(\d+)\s+`）→ `=== CONTENT_START ===`（進入內容）→ 內容累積（以 `\n` 接）直到 `=== FILE_END ===` 或 shell 提示（`# `/`$ ` 結尾）；命令回音行（含 `cat "path"`/`cat path`/`base64`/`Binary file detected`/`wc -c`）在未進內容前略過。
- 缺 FILE_START 或 CONTENT_START → 錯誤 `"File transfer incomplete - missing markers"`。
- **bug #6 修正**：二進位（內容含 `Binary file detected, encoding...`）先去標記+trim 再 base64 解碼，`verified = 解碼後長度 == expected_size`；**不**做解碼前的編碼長度預檢。文字維持 Electron 的 10% 容差（超過則錯 `File size mismatch: expected X bytes, got Y bytes`）。
- 接收指令（換行結尾）：
  - 文字：`echo "=== FILE_START ===" && wc -c "<p>" && echo "=== CONTENT_START ===" && cat "<p>" && echo "=== FILE_END ==="\n`
  - 二進位：`echo "=== FILE_START ===" && wc -c "<p>" && echo "=== CONTENT_START ===" && echo "Binary file detected, encoding..." && base64 "<p>" && echo "=== FILE_END ==="\n`
- 文字判定 `is_likely_text`：副檔名屬 `.txt/.log/.conf/.cfg/.json/.xml/.html/.css/.js/.sh/.py/.md/.yml/.yaml` 或檔名無 `.` → true。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/serial_xfer.rs` — `is_likely_text`、`build_receive_command`、`parse_file_response`、`finalize`（+ 型別）+ 測試

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `base64 = "0.22"`
- `src-tauri/src/lib.rs` — 宣告 `mod serial_xfer;`

**不動：** 前端、command、capabilities。

---

## Task 1: `serial_xfer.rs`（純解析/解碼 + 測試）

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`; Create `src-tauri/src/serial_xfer.rs`

- [ ] **Step 1: 加 base64（Cargo.toml）** — `base64 = "0.22"`

- [ ] **Step 2: 建立 `src-tauri/src/serial_xfer.rs`**

```rust
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
    let mut file_end = false;

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
            file_end = true;
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
        if in_content && !file_end && (line == "# " || line == "$ " || line.ends_with("# ") || line.ends_with("$ ")) {
            break;
        }
        if in_content && !file_end {
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
        let b64 = content.replace(BIN_MARKER, "");
        let b64 = b64.trim();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn likely_text_by_extension_or_no_dot() {
        assert!(is_likely_text("/a/b/config.json"));
        assert!(is_likely_text("/a/b/README")); // 無 .
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

    // bug #6：二進位以「解碼後長度」驗證；不再被編碼長度預檢誤拒。
    #[test]
    fn finalize_binary_decodes_then_verifies() {
        // base64("Hello")=SGVsbG8= → 5 bytes
        let content = "Binary file detected, encoding...\nSGVsbG8=";
        let f = finalize(content, Some(5)).unwrap();
        assert_eq!(f.bytes, b"Hello");
        assert_eq!(f.verified, Some(true)); // 解碼後 5 == expected 5（Electron 舊版會以編碼長度 ~8 預檢而誤拒）
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
}
```

- [ ] **Step 3: 在 lib.rs 宣告 `mod serial_xfer;`**

- [ ] **Step 4: 跑測試** — Run: `cd src-tauri && cargo test serial_xfer`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`；首次下載 base64）；Expected: 9 個測試 PASS（含 bug #6 的 `finalize_binary_decodes_then_verifies`）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/serial_xfer.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): serial file-transfer parsing/decode helpers (fix bug #6)"
```

---

## Task 2: 驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — `cd src-tauri && cargo test`；Expected: 既有 60 + serial_xfer 9 共 69 全綠。
- [ ] **Step 2: 編譯** — `cd src-tauri && cargo build`；Expected: 無錯；警告只剩既有 `AppError::NotFound`。
- [ ] **Step 3: 確認 diff 為 Rust-only**（不動前端）— `git diff --name-only master..HEAD` 應只含 src-tauri；前端 vitest 不受影響（基準 699）。
- [ ] **Step 4: 最終 code review + finishing-a-development-branch。**

---

## 階段 4b-1 完成定義

- [ ] `is_likely_text`、`build_receive_command`、`parse_file_response`、`finalize`（修 bug #6）全數測試綠
- [ ] `cargo test` 全綠、`cargo build` 乾淨；diff Rust-only（前端無回歸）
- [ ] 無 command/前端變更（純函式，消費者為 4b-2+）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron receiveSingleFileSerial 的解析（標記掃描、錯誤偵測、命令回音略過、size 行）與接收指令模板；修 spec §7 bug #6（解碼後再驗證、移除編碼長度預檢；文字維持 10% 容差）。send-file-xmodem 與接收編排（單檔 I/O、目錄）屬 4b-2+。
- **拆分理由**：解析/解碼/指令建構是 4b 唯一可被單元測試釘住正確性的純邏輯（尤其 bug #6）；序列 I/O 編排無法本機驗證，先把純邏輯測好。
- **bug #6**：`finalize` 二進位路徑先解碼再以解碼長度設 verified、不做編碼長度預檢（`finalize_binary_decodes_then_verifies` 釘住）；文字維持 Electron 的 10% 容差與錯誤訊息。
- **Placeholder 掃描**：無 TBD/TODO。
- **型別一致性**：`ParsedContent{content,expected_size}`、`Finalized{bytes,verified}`；`base64`/`regex` 已是相依；`#![allow(dead_code)]`（消費者 4b-2+）。
