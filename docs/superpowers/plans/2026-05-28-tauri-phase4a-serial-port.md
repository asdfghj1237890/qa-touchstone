# Tauri 遷移 — 階段 4a：序列埠管理 + 資料串流（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust（`serialport` crate）移植序列埠管理：列舉/設定/開啟/關閉/送資料/開始監聽，並把背景讀取以 `serial-data-received` / `serial-error` 事件串流到前端。把前端 `src/api` 對應 6 個方法從 `NotPortedError` 換成真實 invoke。XMODEM 風格的檔案收發（`send-file-xmodem`/`receive-file-xmodem`，實為自訂 shell-prompt 協定）+ `xmodem-progress` + spec §7 bug #6 屬階段 4b，不在此。

**Architecture:** 延續方案 A。後端新增 `commands/serial.rs`，`AppState` 加 `serial: Mutex<SerialState>`（單一開啟埠 + 背景讀取執行緒的停止旗標）。開啟用 `serialport::new(...).open()`；開始監聽時 `try_clone()` 出讀取 handle 丟到背景 `std::thread`，迴圈讀取（帶 timeout 以便定期檢查停止旗標）、逐塊 `app.emit(SERIAL_DATA_RECEIVED, String)`；寫入走主 handle。對齊 Electron：單一埠（開新前先關舊）、預設 COM7/9600/8N1、事件 payload 皆為字串。

**Tech Stack:** Rust（`serialport` 4.x、std::thread、parking_lot、tauri 2）。

**⚠️ 驗證界線：** 序列 I/O 的開啟/讀/寫/監聽**只能在實體序列埠 + RFD 裝置上驗證**。本機自動化只能驗：`serialport` crate 編譯通過、`available_ports()` 可呼叫（回機器上的埠，可能為空）、純對映/設定 helper 的單元測試、App 啟動正常。實機行為由使用者驗證。

參照：Electron serial handlers（electron.js:2827-2926、3877-3930）、globals（:2811-2825）、事件（serial-data-received :3914、serial-error :3921）。`events.rs` 的 `SERIAL_DATA_RECEIVED`/`SERIAL_ERROR` 常數與前端 `onSerialDataReceived`/`onSerialError` 訂閱已就緒（階段 0）。

**逐字保留的契約：**
- `list_serial_ports` → 物件陣列，每筆含 `path`、`manufacturer`（前端讀這兩個）；錯誤 → `[]`。
- `configure_serial_port(config)` → 合併 `{port,baudRate,...}` 進模組設定；回 `{success:true}`/`{success:false,error}`。
- `open_serial_port(portPath)` → 先關舊、開新；成功 `{success:true, port}`，失敗 `{success:false, error}`（不 reject——本移植統一回物件）。
- `close_serial_port()` → 關閉 + 停讀取執行緒；回 `{success:true}`。
- `send_serial_data(data)` → 寫字串；埠未開 `{success:false,error:"Serial port not open"}`；回 `{success}`/`{success:false,error}`。
- `start_serial_listening()` → 啟動背景讀取（emit serial-data-received/serial-error）；埠未開 `{success:false,error:"Serial port not open"}`；回 `{success:true}`。
- 事件 payload：`serial-data-received` = UTF-8 字串；`serial-error` = 錯誤字串。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/serial.rs` — 6 個 command + 背景讀取 + 純 helper（port 對映、config 合併、bits/parity 對映）+ 測試

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `serialport = "4"`
- `src-tauri/src/state.rs` — 加 `SerialState`/`SerialConfig` 與 `AppState.serial`
- `src-tauri/src/commands/mod.rs` — 加 `serial`
- `src-tauri/src/lib.rs` — 註冊 6 個 command

**修改（前端）**
- `src/api/index.js` — 6 個序列方法改真實 invoke（`sendFileSerial`/`receiveFileSerial` 維持 notPorted → 4b）
- `src/api/index.test.js` — 加測試

---

## Task 1: `serialport` 相依 + state + `serial.rs`

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/state.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`; Create `src-tauri/src/commands/serial.rs`

- [ ] **Step 1: 加相依（Cargo.toml）**

```toml
serialport = "4"
```

- [ ] **Step 2: `state.rs` 加序列狀態**

把 `state.rs` 改為：
```rust
use parking_lot::Mutex;

#[derive(Clone)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
}

impl Default for SerialConfig {
    fn default() -> Self {
        Self { port: "COM7".into(), baud_rate: 9600, data_bits: 8, stop_bits: 1, parity: "none".into() }
    }
}

/// 單一開啟的序列埠 + 背景讀取執行緒停止旗標。
#[derive(Default)]
pub struct SerialState {
    pub config: SerialConfig,
    pub port: Option<Box<dyn serialport::SerialPort>>,
    pub reader_stop: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

/// 全域共享狀態。
#[derive(Default)]
pub struct AppState {
    /// 階段 2 用：目前執行中的子程序 PID（佔位）。
    pub current_process_pid: Mutex<Option<u32>>,
    /// flashPathData 讀改寫序列化鎖。
    pub flash_lock: Mutex<()>,
    /// 序列埠狀態（單一埠）。
    pub serial: Mutex<SerialState>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
```
> `SerialConfig` 需手動 impl Default（非全空），`SerialState` 因此可 derive Default。`Box<dyn serialport::SerialPort>` 是 Send，置於 `Mutex` 內使 `AppState` 維持 Send+Sync。

- [ ] **Step 3: 建立 `src-tauri/src/commands/serial.rs`**

```rust
use crate::events::{SERIAL_DATA_RECEIVED, SERIAL_ERROR};
use crate::state::{AppState, SerialConfig};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct SerialResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
}

impl SerialResult {
    fn ok() -> Self { Self { success: true, error: None, port: None } }
    fn ok_port(p: String) -> Self { Self { success: true, error: None, port: Some(p) } }
    fn err(e: String) -> Self { Self { success: false, error: Some(e), port: None } }
}

fn data_bits(n: u8) -> serialport::DataBits {
    match n {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    }
}

fn stop_bits(n: u8) -> serialport::StopBits {
    match n {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    }
}

fn parity(s: &str) -> serialport::Parity {
    match s.to_lowercase().as_str() {
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    }
}

/// 把 config Value 合併進 SerialConfig（對齊 Electron 的 {...cfg, ...incoming}）。
fn apply_config(cfg: &mut SerialConfig, incoming: &Value) {
    if let Some(p) = incoming.get("port").and_then(|v| v.as_str()) {
        cfg.port = p.to_string();
    }
    if let Some(b) = incoming.get("baudRate").and_then(|v| v.as_u64()) {
        cfg.baud_rate = b as u32;
    }
    if let Some(d) = incoming.get("dataBits").and_then(|v| v.as_u64()) {
        cfg.data_bits = d as u8;
    }
    if let Some(s) = incoming.get("stopBits").and_then(|v| v.as_u64()) {
        cfg.stop_bits = s as u8;
    }
    if let Some(par) = incoming.get("parity").and_then(|v| v.as_str()) {
        cfg.parity = par.to_string();
    }
}

/// 把列舉到的埠對映成前端要的 {path, manufacturer}。
fn port_entry(path: &str, manufacturer: Option<&str>) -> Value {
    json!({
        "path": path,
        "manufacturer": manufacturer.unwrap_or("Unknown"),
    })
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<Value> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .into_iter()
            .map(|p| {
                let manufacturer = match &p.port_type {
                    serialport::SerialPortType::UsbPort(info) => info.manufacturer.clone(),
                    _ => None,
                };
                port_entry(&p.port_name, manufacturer.as_deref())
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn configure_serial_port(state: State<AppState>, config: Value) -> SerialResult {
    let mut s = state.serial.lock();
    apply_config(&mut s.config, &config);
    SerialResult::ok()
}

fn stop_reader(s: &mut crate::state::SerialState) {
    if let Some(flag) = s.reader_stop.take() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn open_serial_port(state: State<AppState>, port_path: Option<String>) -> SerialResult {
    let mut s = state.serial.lock();
    // 先關舊
    stop_reader(&mut s);
    s.port = None;

    let path = match port_path.filter(|p| !p.is_empty()) {
        Some(p) => p,
        None => s.config.port.clone(),
    };
    s.config.port = path.clone();
    let cfg = s.config.clone();

    let built = serialport::new(&path, cfg.baud_rate)
        .data_bits(data_bits(cfg.data_bits))
        .stop_bits(stop_bits(cfg.stop_bits))
        .parity(parity(&cfg.parity))
        .timeout(Duration::from_millis(100))
        .open();

    match built {
        Ok(port) => {
            s.port = Some(port);
            SerialResult::ok_port(path)
        }
        Err(e) => SerialResult::err(e.to_string()),
    }
}

#[tauri::command]
pub fn close_serial_port(state: State<AppState>) -> SerialResult {
    let mut s = state.serial.lock();
    stop_reader(&mut s);
    s.port = None; // drop → 關閉
    SerialResult::ok()
}

#[tauri::command]
pub fn send_serial_data(state: State<AppState>, data: String) -> SerialResult {
    let mut s = state.serial.lock();
    match s.port.as_mut() {
        Some(port) => match port.write_all(data.as_bytes()) {
            Ok(()) => SerialResult::ok(),
            Err(e) => SerialResult::err(e.to_string()),
        },
        None => SerialResult::err("Serial port not open".into()),
    }
}

#[tauri::command]
pub fn start_serial_listening(app: AppHandle, state: State<AppState>) -> SerialResult {
    let mut s = state.serial.lock();
    // 停掉舊的讀取執行緒（避免重複）
    stop_reader(&mut s);

    let reader = match s.port.as_ref() {
        Some(port) => match port.try_clone() {
            Ok(r) => r,
            Err(e) => return SerialResult::err(e.to_string()),
        },
        None => return SerialResult::err("Serial port not open".into()),
    };

    let stop = Arc::new(AtomicBool::new(false));
    s.reader_stop = Some(stop.clone());
    let app_c = app.clone();

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 1024];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_c.emit(SERIAL_DATA_RECEIVED, chunk);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {} // 無資料，續迴圈
                Err(e) => {
                    let _ = app_c.emit(SERIAL_ERROR, e.to_string());
                    break;
                }
            }
        }
    });

    SerialResult::ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_and_parity_mapping() {
        assert_eq!(data_bits(8), serialport::DataBits::Eight);
        assert_eq!(data_bits(7), serialport::DataBits::Seven);
        assert_eq!(stop_bits(1), serialport::StopBits::One);
        assert_eq!(stop_bits(2), serialport::StopBits::Two);
        assert_eq!(parity("none"), serialport::Parity::None);
        assert_eq!(parity("Odd"), serialport::Parity::Odd);
        assert_eq!(parity("even"), serialport::Parity::Even);
    }

    #[test]
    fn apply_config_merges_fields() {
        let mut cfg = SerialConfig::default();
        apply_config(&mut cfg, &json!({ "port": "COM3", "baudRate": 115200 }));
        assert_eq!(cfg.port, "COM3");
        assert_eq!(cfg.baud_rate, 115200);
        assert_eq!(cfg.data_bits, 8); // 未提供 → 保留預設
        assert_eq!(cfg.parity, "none");
    }

    #[test]
    fn port_entry_shape() {
        let e = port_entry("COM7", Some("Acme"));
        assert_eq!(e["path"], "COM7");
        assert_eq!(e["manufacturer"], "Acme");
        let e2 = port_entry("COM1", None);
        assert_eq!(e2["manufacturer"], "Unknown");
    }

    #[test]
    fn list_serial_ports_does_not_panic() {
        // 在無埠的機器上應回空陣列、不 panic。
        let _ = list_serial_ports();
    }
}
```

- [ ] **Step 4: `commands/mod.rs` 加 `pub mod serial;`**（字母序：…, process, serial, store, …）

- [ ] **Step 5: 註冊（lib.rs，於 api/postman 之後）**

```rust
            commands::serial::list_serial_ports,
            commands::serial::configure_serial_port,
            commands::serial::open_serial_port,
            commands::serial::close_serial_port,
            commands::serial::send_serial_data,
            commands::serial::start_serial_listening,
```

- [ ] **Step 6: 編譯 + 測試**

Run: `cd src-tauri && cargo test serial`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`；首次下載 serialport）
Expected: 4 個測試 PASS（mapping、config 合併、port_entry、list 不 panic）、`cargo build` 成功。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/state.rs src-tauri/src/commands/serial.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): serial port management commands (list/open/close/send/listen)"
```

---

## Task 2: 前端 api 接線

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 測試（index.test.js，最後一個測試後）**

```javascript
  it('listSerialPorts 轉呼 invoke list_serial_ports', async () => {
    invokeMock.mockResolvedValue([{ path: 'COM7', manufacturer: 'Acme' }]);
    await expect(api.listSerialPorts()).resolves.toEqual([{ path: 'COM7', manufacturer: 'Acme' }]);
    expect(invokeMock).toHaveBeenCalledWith('list_serial_ports');
  });

  it('configureSerialPort 帶 config', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.configureSerialPort({ port: 'COM3', baudRate: 9600 });
    expect(invokeMock).toHaveBeenCalledWith('configure_serial_port', { config: { port: 'COM3', baudRate: 9600 } });
  });

  it('openSerialPort 帶 portPath', async () => {
    invokeMock.mockResolvedValue({ success: true, port: 'COM3' });
    await api.openSerialPort('COM3');
    expect(invokeMock).toHaveBeenCalledWith('open_serial_port', { portPath: 'COM3' });
  });

  it('closeSerialPort / sendSerialData / startSerialListening 轉呼對應 invoke', async () => {
    invokeMock.mockResolvedValue({ success: true });
    await api.closeSerialPort();
    expect(invokeMock).toHaveBeenCalledWith('close_serial_port');
    await api.sendSerialData('AT\r');
    expect(invokeMock).toHaveBeenCalledWith('send_serial_data', { data: 'AT\r' });
    await api.startSerialListening();
    expect(invokeMock).toHaveBeenCalledWith('start_serial_listening');
  });
```

- [ ] **Step 2: 跑測試確認失敗** — Run: `npx vitest run src/api/index.test.js`；Expected: 新測試 FAIL。

- [ ] **Step 3: 實作（index.js）** — 把這 6 行（原 notPorted）改為（`sendFileSerial`/`receiveFileSerial` **維持** notPorted → 4b）：
```javascript
  listSerialPorts: () => invoke('list_serial_ports'),
  configureSerialPort: (config) => invoke('configure_serial_port', { config }),
  openSerialPort: (portPath) => invoke('open_serial_port', { portPath }),
  closeSerialPort: () => invoke('close_serial_port'),
  sendSerialData: (data) => invoke('send_serial_data', { data }),
  startSerialListening: () => invoke('start_serial_listening'),
```

- [ ] **Step 4: 跑測試** — Run: `npx vitest run src/api/index.test.js`；Expected: 全 PASS。
- [ ] **Step 5: 全套件** — Run: `npx vitest run`；Expected: 無新增 failure（基準 694）。
- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire serial port management methods to tauri"
```

---

## Task 3: 驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — `cd src-tauri && cargo test`；Expected: 既有 56 + serial 4 共 60 全綠。
- [ ] **Step 2: 前端全測試** — `npx vitest run`；Expected: 基準 694 + 5 = 699，無回歸。
- [ ] **Step 3: 啟動煙霧** — `npm run tauri:dev`；Expected: App 啟動、6 個 serial command 已註冊、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 手動 + 實機驗收（需實體序列埠 + RFD 裝置）**
  - FilesPage：列出序列埠（顯示 path/manufacturer）。
  - 選埠 + 設定 baud → 開啟 → 開始監聽 → 裝置輸出即時顯示（serial-data-received）。
  - 送指令（若 UI 有）→ 裝置回應。
  - 關閉 → 讀取停止、埠釋放。
  - XMODEM 檔案收發（sendFileSerial/receiveFileSerial）→ 仍 NotPortedError 優雅降級（屬 4b）。
- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 4a 完成定義

- [ ] 6 個序列 command 實作 + 註冊；前端 6 方法接上（XMODEM 仍 notPorted）
- [ ] 背景讀取以 serial-data-received/serial-error 串流（實機驗證）
- [ ] `cargo test` 綠（mapping/config/port_entry/list 純測試）、前端 vitest 無回歸、App 啟動正常
- [ ] **實機**：列舉/開關/監聽/送資料正常（使用者驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對應 spec §1 serial.rs 的序列埠部分（XMODEM 收發劃到 4b）、§3 序列資料流（背景讀取 task + 事件；本版用 try_clone 讀取執行緒 + 停止旗標達成隔離，較 channel-actor 簡單但同樣避免讀寫競爭）。事件名與前端既有訂閱一致。
- **驗證界線**：序列 I/O 無法本機驗證（無硬體）；純 helper（bits/parity 對映、config 合併、port_entry、list 不 panic）已測；其餘列入實機驗收。
- **Placeholder 掃描**：無 TBD/TODO。
- **型別一致性**：`SerialResult{success,error?,port?}` 涵蓋各回傳；command 名 snake_case 對應前端 `invoke('...')`；參數鍵 camelCase（`config`/`portPath`/`data`）；事件常數 `SERIAL_DATA_RECEIVED`/`SERIAL_ERROR` 與前端 subscribe 一致；`AppState.serial: Mutex<SerialState>` 維持 Send+Sync（Box<dyn SerialPort> 為 Send）。
- **單一埠**：對齊 Electron——`open` 先停讀取執行緒並 drop 舊埠再開新；`close` 同樣停讀取 + drop。
