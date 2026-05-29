//! 前後端共用的事件名稱常數（與 src/api/index.js 對應）。
#![allow(dead_code)]

pub const COMMAND_OUTPUT: &str = "command-output";
pub const CONFIG_UPDATED: &str = "config-updated";
pub const CONFIG_LOADED: &str = "config-loaded";
pub const POSTMAN_COLLECTIONS_UPDATED: &str = "postman-collections-updated";
pub const XMODEM_PROGRESS: &str = "xmodem-progress";
pub const SERIAL_DATA_RECEIVED: &str = "serial-data-received";
pub const SERIAL_ERROR: &str = "serial-error";
