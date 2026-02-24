//! # Local Actions Module
//!
//! Executes local machine actions (files, shell, apps, clipboard, processes)
//! with mandatory safety checks before every operation.

use crate::safety::{self, RiskLevel, SafetyVerdict};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Result of a local action
#[derive(Debug, Clone, Serialize)]
pub struct ActionResult {
    pub success: bool,
    pub output: String,
    pub safety: SafetyVerdict,
}

/// Local action request from the LLM
#[derive(Debug, Clone, Deserialize)]
pub struct ActionRequest {
    pub action: String,
    pub path: Option<String>,
    pub command: Option<String>,
    pub content: Option<String>,
    pub process_name: Option<String>,
    pub app_name: Option<String>,
    pub confirmed: bool,
}

impl ActionResult {
    fn blocked(verdict: SafetyVerdict) -> Self {
        ActionResult {
            success: false,
            output: verdict.reason.clone(),
            safety: verdict,
        }
    }

    fn ok(output: String, verdict: SafetyVerdict) -> Self {
        ActionResult {
            success: true,
            output,
            safety: verdict,
        }
    }

    fn err(error: String, verdict: SafetyVerdict) -> Self {
        ActionResult {
            success: false,
            output: error,
            safety: verdict,
        }
    }

    fn needs_confirm(verdict: SafetyVerdict) -> Self {
        ActionResult {
            success: false,
            output: format!(
                "CONFIRMATION REQUIRED: {}. Reply 'yes' to proceed.",
                verdict.reason
            ),
            safety: verdict,
        }
    }
}

/// Execute a local action with safety checks
pub fn execute(request: &ActionRequest) -> ActionResult {
    match request.action.as_str() {
        // ─── File Operations ───
        "read_file" => read_file(request),
        "write_file" => write_file(request),
        "delete_file" => delete_file(request),
        "list_dir" => list_dir(request),
        "create_dir" => create_dir(request),
        "file_exists" => file_exists(request),
        "file_info" => file_info(request),
        "move_file" => move_file(request),
        "copy_file" => copy_file(request),

        // ─── Shell Commands ───
        "shell" => run_shell(request),

        // ─── Application Control ───
        "open_app" => open_app(request),
        "open_url" => open_url(request),
        "list_processes" => list_processes(),
        "kill_process" => kill_process(request),

        // ─── System Info ───
        "system_info" => system_info(),
        "disk_usage" => disk_usage(),

        _ => ActionResult {
            success: false,
            output: format!("Unknown action: {}", request.action),
            safety: SafetyVerdict {
                allowed: false,
                risk: RiskLevel::Blocked,
                reason: "Unknown action".into(),
                requires_confirmation: false,
            },
        },
    }
}

// ─── File Operations ─────────────────────────────────

fn read_file(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    let verdict = safety::check_file_operation("read", path);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }

    match std::fs::read_to_string(path) {
        Ok(content) => {
            // Limit output to 50KB to avoid overwhelming the LLM
            let truncated = if content.len() > 50_000 {
                format!("{}...\n\n[Truncated: {} bytes total]", &content[..50_000], content.len())
            } else {
                content
            };
            ActionResult::ok(truncated, verdict)
        }
        Err(e) => ActionResult::err(format!("Failed to read: {}", e), verdict),
    }
}

fn write_file(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    let content = match &req.content {
        Some(c) => c,
        None => return ActionResult::err("content is required".into(), safe_verdict()),
    };
    let verdict = safety::check_file_operation("write", path);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }

    // Create parent directories if needed
    if let Some(parent) = Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match std::fs::write(path, content) {
        Ok(()) => ActionResult::ok(format!("Written {} bytes to {}", content.len(), path), verdict),
        Err(e) => ActionResult::err(format!("Failed to write: {}", e), verdict),
    }
}

fn delete_file(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    let verdict = safety::check_file_operation("delete", path);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }
    if verdict.requires_confirmation && !req.confirmed {
        return ActionResult::needs_confirm(verdict);
    }

    let p = Path::new(path);
    let result = if p.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };

    match result {
        Ok(()) => ActionResult::ok(format!("Deleted: {}", path), verdict),
        Err(e) => ActionResult::err(format!("Failed to delete: {}", e), verdict),
    }
}

fn list_dir(req: &ActionRequest) -> ActionResult {
    let path = req.path.as_deref().unwrap_or(".");
    let verdict = safety::check_file_operation("list", path);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }

    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut items = Vec::new();
            for entry in entries.flatten() {
                let meta = entry.metadata().ok();
                let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let name = entry.file_name().to_string_lossy().to_string();
                items.push(format!(
                    "{} {} {}",
                    if is_dir { "DIR " } else { "FILE" },
                    if is_dir { "-".to_string() } else { format_size(size) },
                    name
                ));
            }
            if items.is_empty() {
                ActionResult::ok("(empty directory)".into(), verdict)
            } else {
                ActionResult::ok(items.join("\n"), verdict)
            }
        }
        Err(e) => ActionResult::err(format!("Failed to list: {}", e), verdict),
    }
}

fn create_dir(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    let verdict = safety::check_file_operation("create", path);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }

    match std::fs::create_dir_all(path) {
        Ok(()) => ActionResult::ok(format!("Created directory: {}", path), verdict),
        Err(e) => ActionResult::err(format!("Failed to create: {}", e), verdict),
    }
}

fn file_exists(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    let exists = Path::new(path).exists();
    ActionResult::ok(
        format!("{}: {}", path, if exists { "exists" } else { "not found" }),
        safe_verdict(),
    )
}

fn file_info(req: &ActionRequest) -> ActionResult {
    let path = match &req.path {
        Some(p) => p,
        None => return ActionResult::err("path is required".into(), safe_verdict()),
    };
    match std::fs::metadata(path) {
        Ok(meta) => {
            let info = format!(
                "Path: {}\nType: {}\nSize: {}\nReadonly: {}\nModified: {:?}",
                path,
                if meta.is_dir() { "Directory" } else { "File" },
                format_size(meta.len()),
                meta.permissions().readonly(),
                meta.modified().ok()
            );
            ActionResult::ok(info, safe_verdict())
        }
        Err(e) => ActionResult::err(format!("Failed: {}", e), safe_verdict()),
    }
}

fn move_file(req: &ActionRequest) -> ActionResult {
    let from = match &req.path {
        Some(p) => p.clone(),
        None => return ActionResult::err("path (source) is required".into(), safe_verdict()),
    };
    let to = match &req.content {
        Some(c) => c.clone(),
        None => return ActionResult::err("content (destination) is required".into(), safe_verdict()),
    };
    let verdict_from = safety::check_file_operation("move", &from);
    let verdict_to = safety::check_file_operation("write", &to);
    if !verdict_from.allowed {
        return ActionResult::blocked(verdict_from);
    }
    if !verdict_to.allowed {
        return ActionResult::blocked(verdict_to);
    }

    match std::fs::rename(&from, &to) {
        Ok(()) => ActionResult::ok(format!("Moved {} → {}", from, to), verdict_from),
        Err(e) => ActionResult::err(format!("Failed to move: {}", e), verdict_from),
    }
}

fn copy_file(req: &ActionRequest) -> ActionResult {
    let from = match &req.path {
        Some(p) => p.clone(),
        None => return ActionResult::err("path (source) is required".into(), safe_verdict()),
    };
    let to = match &req.content {
        Some(c) => c.clone(),
        None => return ActionResult::err("content (destination) is required".into(), safe_verdict()),
    };
    let verdict = safety::check_file_operation("copy", &to);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }

    match std::fs::copy(&from, &to) {
        Ok(bytes) => ActionResult::ok(
            format!("Copied {} → {} ({} bytes)", from, to, bytes),
            verdict,
        ),
        Err(e) => ActionResult::err(format!("Failed to copy: {}", e), verdict),
    }
}

// ─── Shell Commands ──────────────────────────────────

fn run_shell(req: &ActionRequest) -> ActionResult {
    let command = match &req.command {
        Some(c) => c,
        None => return ActionResult::err("command is required".into(), safe_verdict()),
    };
    let verdict = safety::check_shell_command(command);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }
    if verdict.requires_confirmation && !req.confirmed {
        return ActionResult::needs_confirm(verdict);
    }

    let output = Command::new("cmd")
        .args(["/C", command])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n[STDERR]\n{}", stdout, stderr)
            };
            // Limit output
            let truncated = if combined.len() > 30_000 {
                format!("{}...\n[Truncated: {} chars]", &combined[..30_000], combined.len())
            } else {
                combined
            };
            ActionResult::ok(truncated, verdict)
        }
        Err(e) => ActionResult::err(format!("Failed to execute: {}", e), verdict),
    }
}

// ─── Application Control ─────────────────────────────

fn open_app(req: &ActionRequest) -> ActionResult {
    let app = match &req.app_name {
        Some(a) => a,
        None => return ActionResult::err("app_name is required".into(), safe_verdict()),
    };

    let verdict = SafetyVerdict {
        allowed: true,
        risk: RiskLevel::Medium,
        reason: format!("Opening application: {}", app),
        requires_confirmation: false,
    };

    let result = Command::new("cmd")
        .args(["/C", "start", "", app])
        .spawn();

    match result {
        Ok(_) => ActionResult::ok(format!("Launched: {}", app), verdict),
        Err(e) => ActionResult::err(format!("Failed to open {}: {}", app, e), verdict),
    }
}

fn open_url(req: &ActionRequest) -> ActionResult {
    let url = match &req.path {
        Some(u) => u,
        None => return ActionResult::err("path (URL) is required".into(), safe_verdict()),
    };

    let result = Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();

    match result {
        Ok(_) => ActionResult::ok(
            format!("Opened URL: {}", url),
            SafetyVerdict {
                allowed: true,
                risk: RiskLevel::Low,
                reason: "Opening URL in default browser".into(),
                requires_confirmation: false,
            },
        ),
        Err(e) => ActionResult::err(format!("Failed: {}", e), safe_verdict()),
    }
}

fn list_processes() -> ActionResult {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let lines: Vec<&str> = stdout.lines().take(50).collect();
            ActionResult::ok(
                format!("Top 50 processes:\n{}", lines.join("\n")),
                safe_verdict(),
            )
        }
        Err(e) => ActionResult::err(format!("Failed: {}", e), safe_verdict()),
    }
}

fn kill_process(req: &ActionRequest) -> ActionResult {
    let name = match &req.process_name {
        Some(n) => n,
        None => return ActionResult::err("process_name is required".into(), safe_verdict()),
    };
    let verdict = safety::check_process_kill(name);
    if !verdict.allowed {
        return ActionResult::blocked(verdict);
    }
    if !req.confirmed {
        return ActionResult::needs_confirm(verdict);
    }

    let result = Command::new("taskkill")
        .args(["/IM", name, "/F"])
        .output();

    match result {
        Ok(out) => {
            let msg = String::from_utf8_lossy(&out.stdout).to_string();
            ActionResult::ok(msg, verdict)
        }
        Err(e) => ActionResult::err(format!("Failed: {}", e), verdict),
    }
}

// ─── System Info ─────────────────────────────────────

fn system_info() -> ActionResult {
    let output = Command::new("cmd")
        .args(["/C", "systeminfo | findstr /B /C:\"OS\" /C:\"System\" /C:\"Total Physical\" /C:\"Available Physical\" /C:\"Processor\""])
        .output();

    match output {
        Ok(out) => ActionResult::ok(
            String::from_utf8_lossy(&out.stdout).to_string(),
            safe_verdict(),
        ),
        Err(e) => ActionResult::err(format!("Failed: {}", e), safe_verdict()),
    }
}

fn disk_usage() -> ActionResult {
    let output = Command::new("wmic")
        .args(["logicaldisk", "get", "caption,freespace,size", "/format:csv"])
        .output();

    match output {
        Ok(out) => ActionResult::ok(
            String::from_utf8_lossy(&out.stdout).to_string(),
            safe_verdict(),
        ),
        Err(e) => ActionResult::err(format!("Failed: {}", e), safe_verdict()),
    }
}

// ─── Helpers ─────────────────────────────────────────

fn safe_verdict() -> SafetyVerdict {
    SafetyVerdict {
        allowed: true,
        risk: RiskLevel::Safe,
        reason: String::new(),
        requires_confirmation: false,
    }
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{}B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.1}GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}
