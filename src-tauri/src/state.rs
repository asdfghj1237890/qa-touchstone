use parking_lot::Mutex;

/// 全域共享狀態。
#[derive(Default)]
pub struct AppState {
    /// 目前執行中的子程序 PID（PerfTest 跑的 k6）。
    pub current_process_pid: Mutex<Option<u32>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
