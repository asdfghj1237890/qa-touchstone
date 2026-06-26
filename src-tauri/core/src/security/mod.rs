//! Security suite engines (SP2). Pure logic + a runner adapter; no Tauri.
pub mod authz;
pub mod bfla;
pub mod bola;
pub mod finding;
pub mod lifecycle;
pub mod oracles;
pub mod ratelimit;
pub mod report;
pub mod runner;
