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
    /// 防止並行檔案傳輸（對齊 Electron 的 activeIpcCalls 拒絕）。
    pub transfer_active: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// 全域共享狀態。
#[derive(Default)]
pub struct AppState {
    /// 階段 2 用：目前執行中的子程序 PID（佔位）。
    pub current_process_pid: Mutex<Option<u32>>,
    /// flashPathData 讀改寫序列化鎖（取代 Electron 的 busy-wait 布林旗標）。
    pub flash_lock: Mutex<()>,
    /// 序列埠狀態（單一埠）。
    pub serial: Mutex<SerialState>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
