//! Security suite engines (SP2). Pure logic + a runner adapter; no Tauri.
pub mod authz;
pub mod bola;
pub mod finding;
pub mod lifecycle;
pub mod ratelimit;
pub mod runner;
