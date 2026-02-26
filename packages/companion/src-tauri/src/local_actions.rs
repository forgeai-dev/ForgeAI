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
    pub cwd: Option<String>,
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

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
    if let Some(cwd) = &req.cwd {
        let cwd_path = std::path::Path::new(cwd);
        if cwd_path.exists() {
            cmd.current_dir(cwd_path);
        }
    }
    let output = cmd.output();

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

// ─── Desktop Automation (Windows PowerShell) ─────────

/// Execute a desktop automation action with raw JSON params.
/// Called directly from the WS loop for action="desktop".
pub fn execute_desktop(params: &serde_json::Value) -> ActionResult {
    let action = params.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target = params.get("target").and_then(|v| v.as_str()).unwrap_or("");
    let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let x = params.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) as i32;
    let y = params.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) as i32;
    let button = params.get("button").and_then(|v| v.as_str()).unwrap_or("left");
    let delay = params.get("delay").and_then(|v| v.as_u64()).unwrap_or(0);

    if action.is_empty() {
        return ActionResult::err("desktop action is required".into(), safe_verdict());
    }

    // Optional delay before action
    if delay > 0 && action != "wait" {
        std::thread::sleep(std::time::Duration::from_millis(delay.min(10_000)));
    }

    match action {
        "list_windows" => desktop_list_windows(),
        "focus_window" => desktop_focus_window(target),
        "open_app" => desktop_open_app(target),
        "send_keys" | "key_combo" => desktop_send_keys(text),
        "type_text" => desktop_type_text(text),
        "click" => desktop_click(x, y, button),
        "screenshot" => desktop_screenshot(target),
        "read_screen" => desktop_read_screen(target),
        "read_window_text" => desktop_read_window_text(target),
        "get_clipboard" => desktop_get_clipboard(),
        "wait" => {
            let ms = if !target.is_empty() {
                target.parse::<u64>().unwrap_or(1000)
            } else if delay > 0 { delay } else { 1000 };
            std::thread::sleep(std::time::Duration::from_millis(ms.min(10_000)));
            ActionResult::ok(format!("WAITED: {}ms", ms), safe_verdict())
        }
        _ => ActionResult::err(format!("Unknown desktop action: {}", action), safe_verdict()),
    }
}

fn run_powershell(script: &str) -> ActionResult {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = if stderr.is_empty() {
                stdout
            } else if stdout.is_empty() {
                format!("[STDERR] {}", stderr)
            } else {
                format!("{}\n[STDERR] {}", stdout, stderr)
            };
            let truncated = if combined.len() > 30_000 {
                format!("{}...[truncated]", &combined[..30_000])
            } else {
                combined
            };
            ActionResult::ok(truncated, safe_verdict())
        }
        Err(e) => ActionResult::err(format!("PowerShell failed: {}", e), safe_verdict()),
    }
}

fn desktop_list_windows() -> ActionResult {
    let script = r#"
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WinAPI {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
    public static string GetTitle(IntPtr h) { int l=GetWindowTextLength(h); if(l==0)return""; var sb=new StringBuilder(l+1); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }
}
"@
$list = @()
[WinAPI]::EnumWindows({ param($h,$l)
    if([WinAPI]::IsWindowVisible($h)) {
        $t=[WinAPI]::GetTitle($h)
        if($t -ne "") {
            $pid=[uint32]0; [WinAPI]::GetWindowThreadProcessId($h,[ref]$pid)|Out-Null
            $p=Get-Process -Id $pid -EA SilentlyContinue
            $list += [PSCustomObject]@{Title=$t; Process=if($p){$p.ProcessName}else{"?"}; PID=$pid}
        }
    }; $true
}, [IntPtr]::Zero)|Out-Null
$list | ConvertTo-Json -Compress
"#;
    run_powershell(script)
}

fn desktop_focus_window(target: &str) -> ActionResult {
    if target.is_empty() {
        return ActionResult::err("target is required for focus_window".into(), safe_verdict());
    }
    let safe = target.replace('\'', "''");
    let script = format!(r#"
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WinAPI {{
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
    public static string GetTitle(IntPtr h) {{ int l=GetWindowTextLength(h); if(l==0)return""; var sb=new StringBuilder(l+1); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }}
}}
"@
$found=$false
[WinAPI]::EnumWindows({{ param($h,$l)
    if([WinAPI]::IsWindowVisible($h)) {{
        $t=[WinAPI]::GetTitle($h)
        if($t -like "*{safe}*") {{
            [WinAPI]::ShowWindow($h,9)|Out-Null; Start-Sleep -Ms 200
            [WinAPI]::SetForegroundWindow($h)|Out-Null
            Write-Output "FOCUSED: $t"
            $script:found=$true; return $false
        }}
    }}; $true
}}, [IntPtr]::Zero)|Out-Null
if(-not $found) {{ Write-Output "NOT_FOUND: No window matching '*{safe}*'" }}
"#);
    run_powershell(&script)
}

fn desktop_open_app(target: &str) -> ActionResult {
    if target.is_empty() {
        return ActionResult::err("target is required for open_app".into(), safe_verdict());
    }
    let safe = target.replace('"', "`\"");
    let script = format!(
        "Start-Process \"{}\" -ErrorAction Stop; Start-Sleep -Seconds 2; Write-Output \"OPENED: {}\"",
        safe, safe
    );
    run_powershell(&script)
}

fn desktop_send_keys(keys: &str) -> ActionResult {
    if keys.is_empty() {
        return ActionResult::err("text is required for send_keys".into(), safe_verdict());
    }
    let escaped = keys.replace('"', "`\"");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Ms 300; [System.Windows.Forms.SendKeys]::SendWait(\"{}\"); Write-Output \"SENT_KEYS: {}\"",
        escaped, &keys[..keys.len().min(50)]
    );
    run_powershell(&script)
}

fn desktop_type_text(text: &str) -> ActionResult {
    if text.is_empty() {
        return ActionResult::err("text is required for type_text".into(), safe_verdict());
    }
    let safe = text.replace('"', "`\"").replace('$', "`$");
    let display = &text[..text.len().min(60)].replace('"', "'");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Ms 200; [System.Windows.Forms.Clipboard]::SetText(\"{}\"); Start-Sleep -Ms 100; [System.Windows.Forms.SendKeys]::SendWait(\"^v\"); Write-Output \"TYPED: {}\"",
        safe, display
    );
    run_powershell(&script)
}

fn desktop_click(x: i32, y: i32, button: &str) -> ActionResult {
    let (down, up) = if button == "right" {
        ("MOUSEEVENTF_RIGHTDOWN", "MOUSEEVENTF_RIGHTUP")
    } else {
        ("MOUSEEVENTF_LEFTDOWN", "MOUSEEVENTF_LEFTUP")
    };
    let script = format!(r#"
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MouseAPI {{
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
    public const uint MOUSEEVENTF_LEFTDOWN=2; public const uint MOUSEEVENTF_LEFTUP=4;
    public const uint MOUSEEVENTF_RIGHTDOWN=8; public const uint MOUSEEVENTF_RIGHTUP=16;
}}
"@
[MouseAPI]::SetCursorPos({x}, {y}); Start-Sleep -Ms 50
[MouseAPI]::mouse_event([MouseAPI]::{down}, 0,0,0,[IntPtr]::Zero); Start-Sleep -Ms 50
[MouseAPI]::mouse_event([MouseAPI]::{up}, 0,0,0,[IntPtr]::Zero)
Write-Output "CLICKED: ({x}, {y}) {button}"
"#, x=x, y=y, down=down, up=up, button=button);
    run_powershell(&script)
}

fn desktop_screenshot(target: &str) -> ActionResult {
    use base64::Engine;

    let dir = std::env::temp_dir().join("forgeai_screenshots");
    let _ = std::fs::create_dir_all(&dir);
    let filename = format!("screenshot_{}.png", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
    let path = dir.join(&filename);
    let path_str = path.to_string_lossy().replace('\\', "\\\\");

    let script = if target.is_empty() {
        // Full screen
        format!(r#"
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b=New-Object System.Drawing.Bitmap($s.Width,$s.Height)
$g=[System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(0,0,0,0,[System.Drawing.Size]::new($s.Width,$s.Height))
$b.Save("{path}")
$g.Dispose(); $b.Dispose()
Write-Output "SCREENSHOT: {path} ($($s.Width)x$($s.Height))"
"#, path=path_str)
    } else {
        // Window screenshot using PrintWindow
        let safe = target.replace('\'', "''");
        format!(r#"
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Drawing;
public class WinAPI {{
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
    [StructLayout(LayoutKind.Sequential)] public struct RECT {{ public int Left,Top,Right,Bottom; }}
    public static string GetTitle(IntPtr h) {{ int l=GetWindowTextLength(h); if(l==0)return""; var sb=new StringBuilder(l+1); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }}
}}
"@
Add-Type -AssemblyName System.Drawing
$script:found=$false
[WinAPI]::EnumWindows({{ param($h,$l)
    if([WinAPI]::IsWindowVisible($h)) {{
        $t=[WinAPI]::GetTitle($h)
        if($t -like "*{safe}*") {{
            $r=New-Object WinAPI+RECT; [WinAPI]::GetWindowRect($h,[ref]$r)|Out-Null
            $w=$r.Right-$r.Left; $ht=$r.Bottom-$r.Top
            if($w -gt 0 -and $ht -gt 0) {{
                $bmp=New-Object System.Drawing.Bitmap($w,$ht)
                $g=[System.Drawing.Graphics]::FromImage($bmp)
                $hdc=$g.GetHdc()
                [WinAPI]::PrintWindow($h,$hdc,2)|Out-Null
                $g.ReleaseHdc($hdc); $g.Dispose()
                $bmp.Save("{path}"); $bmp.Dispose()
                Write-Output "SCREENSHOT: {path} (${{w}}x${{ht}}) [window: $t]"
                $script:found=$true; return $false
            }}
        }}
    }}; $true
}}, [IntPtr]::Zero)|Out-Null
if(-not $found) {{ Write-Output "NOT_FOUND: No window matching '*{safe}*'" }}
"#, safe=safe, path=path_str)
    };

    let ps_result = run_powershell(&script);
    if !ps_result.success {
        return ps_result;
    }

    // Read the PNG file and base64-encode it so the Gateway can save + display the image
    let real_path = path.to_string_lossy().to_string();
    match std::fs::read(&path) {
        Ok(bytes) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let json_output = serde_json::json!({
                "output": ps_result.output.trim(),
                "filename": filename,
                "image_base64": b64,
            });
            ActionResult::ok(json_output.to_string(), safe_verdict())
        }
        Err(e) => {
            // File not found — return the PS output anyway
            log::warn!("[desktop_screenshot] Could not read {}: {}", real_path, e);
            ps_result
        }
    }
}

fn desktop_read_screen(target: &str) -> ActionResult {
    // Screenshot + OCR using Windows OCR API
    let dir = std::env::temp_dir().join("forgeai_screenshots");
    let _ = std::fs::create_dir_all(&dir);
    let filename = format!("ocr_{}.png", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
    let path = dir.join(&filename);
    let path_str = path.to_string_lossy().replace('\\', "\\\\");

    // First take screenshot
    let screenshot_result = if target.is_empty() {
        desktop_screenshot("")
    } else {
        desktop_screenshot(target)
    };

    if !screenshot_result.success {
        return screenshot_result;
    }

    // Now run OCR on the screenshot
    let ocr_script = format!(r#"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]
$asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'}})[0]
Function AwaitOp($t,$r){{$task=$asTaskGeneric.MakeGenericMethod($r).Invoke($null,@($t));if(-not $task.Wait(20000)){{throw "timeout"}};$task.Result}}
try {{
    $f=AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{path}')) ([Windows.Storage.StorageFile])
    $s=AwaitOp ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $d=AwaitOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $b=AwaitOp ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $e=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if(-not $e){{$e=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))}}
    if($e){{$r=AwaitOp ($e.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult]); Write-Output $r.Text}}
    else{{Write-Output "OCR_ERROR: No OCR engine available"}}
}} catch {{ Write-Output "OCR_ERROR: $($_.Exception.Message)" }}
"#, path=path_str);

    let ocr_result = run_powershell(&ocr_script);
    // Combine screenshot path and OCR text
    ActionResult::ok(
        format!("screenshot={}\ntext:{}", path_str, ocr_result.output),
        safe_verdict(),
    )
}

fn desktop_read_window_text(target: &str) -> ActionResult {
    if target.is_empty() {
        return ActionResult::err("target is required for read_window_text".into(), safe_verdict());
    }
    let safe = target.replace('\'', "''");
    let script = format!(r#"
Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
$wins=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$tw=$null
foreach($w in $wins){{ try{{ if($w.Current.Name -like "*{safe}*"){{$tw=$w;break}} }}catch{{}} }}
if(-not $tw){{ Write-Output "NOT_FOUND: No window matching '*{safe}*'"; return }}
$texts=@()
$tc=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Text)
$els=$tw.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tc)
foreach($el in $els){{ try{{ $n=$el.Current.Name; if($n -and $n.Trim()){{$texts+=$n.Trim()}} }}catch{{}} }}
$ec=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
$edits=$tw.FindAll([System.Windows.Automation.TreeScope]::Descendants,$ec)
foreach($el in $edits){{ try{{ $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if($vp -and $vp.Current.Value){{$texts+="[INPUT] "+$vp.Current.Value}} }}catch{{}} }}
if($texts.Count -eq 0){{ Write-Output "NO_TEXT_FOUND: Window found but no readable text" }}
else{{ $texts -join [Environment]::NewLine }}
"#, safe=safe);
    run_powershell(&script)
}

fn desktop_get_clipboard() -> ActionResult {
    run_powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()")
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
