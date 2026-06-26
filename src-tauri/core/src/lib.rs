//! qa_touchstone_core — Tauri-free request execution + (later) analysis logic,
//! shared by the desktop app and the headless CLI.

pub mod aws;
pub mod buildreq;
pub mod config;
pub mod datafile;
pub mod engine;
pub mod executor;
pub mod redact;
pub mod reqprep;
pub mod security;
pub mod step;
pub mod xml;
