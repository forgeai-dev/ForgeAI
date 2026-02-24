//! # Tauri IPC Commands
//!
//! These are the commands exposed to the React frontend via Tauri's invoke system.
//! Every command that performs a local action goes through the safety system.

use crate::local_actions::{self, ActionRequest, ActionResult};
use crate::safety;
use serde::{Deserialize, Serialize};

/// Status response for the frontend
#[derive(Debug, Clone, Serialize)]
pub struct CompanionStatus {
    pub connected: bool,
    pub gateway_url: Option<String>,
    pub safety_active: bool,
    pub version: String,
}

/// Pairing request from frontend
#[derive(Debug, Clone, Deserialize)]
pub struct PairRequest {
    pub gateway_url: String,
    pub pairing_code: String,
}

/// Execute a local action (called by the Gateway via LLM tool calls)
#[tauri::command]
pub fn execute_action(request: ActionRequest) -> ActionResult {
    log::info!("Executing action: {} (confirmed: {})", request.action, request.confirmed);
    let result = local_actions::execute(&request);
    log::info!(
        "Action result: success={}, risk={:?}",
        result.success,
        result.safety.risk
    );
    result
}

/// Check if an action is safe without executing it
#[tauri::command]
pub fn check_safety(action: String, path: Option<String>, command: Option<String>) -> safety::SafetyVerdict {
    if let Some(cmd) = &command {
        return safety::check_shell_command(cmd);
    }
    if let Some(p) = &path {
        return safety::check_file_operation(&action, p);
    }
    safety::SafetyVerdict {
        allowed: true,
        risk: safety::RiskLevel::Safe,
        reason: "No path or command to check".into(),
        requires_confirmation: false,
    }
}

/// Get the safety system prompt (injected into every LLM request)
#[tauri::command]
pub fn get_safety_prompt() -> String {
    safety::get_safety_system_prompt()
}

/// Get companion status
#[tauri::command]
pub fn get_status() -> CompanionStatus {
    let creds = crate::connection::GatewayConnection::load_credentials();
    CompanionStatus {
        connected: creds.is_some(),
        gateway_url: creds.map(|c| c.gateway_url),
        safety_active: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Delete stored credentials (disconnect)
#[tauri::command]
pub fn disconnect() -> Result<String, String> {
    crate::connection::GatewayConnection::delete_credentials()?;
    Ok("Disconnected and credentials removed".into())
}

/// Get system info (safe, no confirmation needed)
#[tauri::command]
pub fn get_system_info() -> ActionResult {
    local_actions::execute(&ActionRequest {
        action: "system_info".into(),
        path: None,
        command: None,
        content: None,
        process_name: None,
        app_name: None,
        confirmed: false,
    })
}
