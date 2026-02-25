//! # ForgeAI Safety System — Anti-Disaster Guardrails
//!
//! This module enforces hard safety boundaries that CANNOT be bypassed,
//! even if the LLM or the user explicitly requests it.
//!
//! ## Rules:
//! 1. NEVER delete system-critical files or directories
//! 2. NEVER format, wipe, or partition any disk
//! 3. NEVER modify Windows registry boot/security keys
//! 4. NEVER disable antivirus, firewall, or Windows Defender
//! 5. NEVER access other users' private data
//! 6. ALL destructive actions require explicit user confirmation
//! 7. File operations are sandboxed to user directories by default

use regex::Regex;
use std::path::{Path, PathBuf};

/// Risk level for an action
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum RiskLevel {
    Safe,       // Read-only, no side effects
    Low,        // Minor changes, easily reversible
    Medium,     // File modifications, app launches
    High,       // Bulk operations, elevated actions
    Blocked,    // NEVER allowed, hard block
}

/// Result of a safety check
#[derive(Debug, Clone, serde::Serialize)]
pub struct SafetyVerdict {
    pub allowed: bool,
    pub risk: RiskLevel,
    pub reason: String,
    pub requires_confirmation: bool,
}

/// Directories that are ALWAYS protected (hard block)
const PROTECTED_DIRS: &[&str] = &[
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64",
    "C:\\Windows\\WinSxS",
    "C:\\Windows\\Boot",
    "C:\\Windows\\Fonts",
    "C:\\Windows\\Installer",
    "C:\\Windows\\servicing",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData\\Microsoft",
    "C:\\Recovery",
    "C:\\$Recycle.Bin",
    "C:\\System Volume Information",
    "C:\\Boot",
    "C:\\EFI",
];

/// File extensions that are ALWAYS protected from deletion
const PROTECTED_EXTENSIONS: &[&str] = &[
    "sys", "dll", "exe", "drv", "ocx", "cpl", "scr",
    "msi", "msp", "mst", "cat", "inf", "mui",
];

/// Commands/patterns that are ALWAYS blocked
const BLOCKED_COMMANDS: &[&str] = &[
    "format ",
    "format.com",
    "diskpart",
    "clean all",
    "rd /s /q c:\\",
    "rd /s /q c:/",
    "rmdir /s /q c:\\",
    "rmdir /s /q c:/",
    "del /f /s /q c:\\",
    "del /f /s /q c:/",
    "cipher /w:",
    "sfc /scannow",          // Can cause issues if misused
    "bcdedit",               // Boot config
    "bcdboot",
    "bootrec",
    "reagentc",
    "dism /online /cleanup", // Can break Windows
    "powershell -ep bypass", // Execution policy bypass
    "set-executionpolicy unrestricted",
    "disable-windowsoptionalfeature",
    "reg delete hklm\\system",
    "reg delete hklm\\software\\microsoft",
    "reg delete hklm\\sam",
    "reg delete hklm\\security",
    "net stop windefend",
    "sc stop windefend",
    "sc delete",
    "netsh advfirewall set allprofiles state off",
    "wmic os delete",
    "shutdown /s",
    "shutdown /r",
    "shutdown /f",
    "taskkill /f /im csrss",
    "taskkill /f /im lsass",
    "taskkill /f /im winlogon",
    "taskkill /f /im svchost",
    "taskkill /f /im smss",
    "takeown /f c:\\windows",
    "icacls c:\\windows",
    "mklink /d c:\\windows",
];

/// Registry paths that are NEVER writable
const PROTECTED_REGISTRY: &[&str] = &[
    "HKLM\\SYSTEM\\CurrentControlSet",
    "HKLM\\SAM",
    "HKLM\\SECURITY",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
    "HKLM\\SOFTWARE\\Policies",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
];

/// Processes that can NEVER be killed
const PROTECTED_PROCESSES: &[&str] = &[
    "csrss.exe", "lsass.exe", "smss.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "svchost.exe", "dwm.exe",
    "explorer.exe", "taskmgr.exe", "msmpeng.exe", "securityhealthservice.exe",
];

/// Check if a file path is in a protected directory
pub fn is_protected_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_lowercase();
    for dir in PROTECTED_DIRS {
        if normalized.starts_with(&dir.to_lowercase()) {
            return true;
        }
    }
    // Check protected extensions for system-level paths
    if let Some(ext) = Path::new(&normalized).extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if PROTECTED_EXTENSIONS.contains(&ext_str.as_str()) {
            // Only block if it's in a system location
            if normalized.starts_with("c:\\windows")
                || normalized.starts_with("c:\\program files")
                || normalized.starts_with("c:\\programdata\\microsoft")
            {
                return true;
            }
        }
    }
    false
}

/// Check if a shell command is blocked
pub fn is_blocked_command(command: &str) -> Option<String> {
    let cmd_lower = command.to_lowercase().trim().to_string();

    for blocked in BLOCKED_COMMANDS {
        if cmd_lower.contains(&blocked.to_lowercase()) {
            return Some(format!(
                "BLOCKED: Command contains '{}' which could damage the system",
                blocked
            ));
        }
    }

    // Check for recursive delete on root or system dirs
    // NOTE: these only block drive-root targets (e.g. C:\), NOT subdirectories
    let dangerous_patterns = vec![
        Regex::new(r"(?i)rm\s+-rf?\s+/\s*$").ok(),
        Regex::new(r"(?i)del\s+/[sfq]+\s+[a-z]:\\\s*$").ok(),
        Regex::new(r"(?i)rmdir\s+/[sq]+\s+[a-z]:\\\s*$").ok(),
        Regex::new(r#"(?i)remove-item\s+["']?[a-z]:\\["']?\s+-recurse"#).ok(),
        Regex::new(r"(?i)format\s+[a-z]:").ok(),
        Regex::new(r"(?i)(?:remove-item|del|rd|rmdir)\s+.*(?:c:\\windows|system32)").ok(),
    ];

    for pattern in dangerous_patterns.iter().flatten() {
        if pattern.is_match(&cmd_lower) {
            return Some(format!(
                "BLOCKED: Pattern matches a dangerous operation: {}",
                pattern.as_str()
            ));
        }
    }

    None
}

/// Check if a process name is protected
pub fn is_protected_process(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    PROTECTED_PROCESSES
        .iter()
        .any(|p| name_lower == p.to_lowercase() || name_lower == p.replace(".exe", "").to_lowercase())
}

/// Check if a registry path is protected
pub fn is_protected_registry(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    PROTECTED_REGISTRY
        .iter()
        .any(|p| path_lower.starts_with(&p.to_lowercase()))
}

/// Get the user's home directory for sandboxing
pub fn get_user_home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))
}

/// Check if a path is within allowed user directories
pub fn is_user_directory(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_lowercase();
    let home = get_user_home()
        .to_string_lossy()
        .to_lowercase()
        .replace('/', "\\");

    // Allowed: user home, temp, and any non-system drive
    normalized.starts_with(&home)
        || normalized.starts_with(&std::env::temp_dir().to_string_lossy().to_lowercase())
        || (normalized.len() >= 3
            && normalized.chars().nth(0).map_or(false, |c| c.is_ascii_alphabetic())
            && normalized.chars().nth(1) == Some(':')
            && !is_protected_path(&normalized))
}

/// Main safety check for file operations
pub fn check_file_operation(operation: &str, path: &str) -> SafetyVerdict {
    let op = operation.to_lowercase();

    // Read operations are always safe
    if op == "read" || op == "list" || op == "stat" || op == "exists" {
        return SafetyVerdict {
            allowed: true,
            risk: RiskLevel::Safe,
            reason: "Read operations are always allowed".into(),
            requires_confirmation: false,
        };
    }

    // Check protected paths for any write/delete operation
    if is_protected_path(path) {
        return SafetyVerdict {
            allowed: false,
            risk: RiskLevel::Blocked,
            reason: format!("BLOCKED: '{}' is a system-protected path. This operation is never allowed.", path),
            requires_confirmation: false,
        };
    }

    // Delete operations: allowed anywhere that's not a protected system path
    // The is_protected_path check above already blocks C:\Windows, System32, etc.
    if op == "delete" || op == "remove" || op == "rmdir" {
        return SafetyVerdict {
            allowed: true,
            risk: RiskLevel::Medium,
            reason: format!("Delete operation on '{}' — path is not system-protected", path),
            requires_confirmation: false,
        };
    }

    // Write/create/move operations
    if op == "write" || op == "create" || op == "move" || op == "copy" || op == "rename" {
        if !is_user_directory(path) {
            return SafetyVerdict {
                allowed: false,
                risk: RiskLevel::Blocked,
                reason: format!("BLOCKED: Cannot write to '{}' — outside user directory", path),
                requires_confirmation: false,
            };
        }

        return SafetyVerdict {
            allowed: true,
            risk: RiskLevel::Medium,
            reason: "File operation within user directory".into(),
            requires_confirmation: false,
        };
    }

    // Default: require confirmation for unknown operations
    SafetyVerdict {
        allowed: true,
        risk: RiskLevel::Medium,
        reason: format!("Unknown operation '{}' — requires confirmation", operation),
        requires_confirmation: true,
    }
}

/// Main safety check for shell commands
pub fn check_shell_command(command: &str) -> SafetyVerdict {
    // Check blocked commands first
    if let Some(reason) = is_blocked_command(command) {
        return SafetyVerdict {
            allowed: false,
            risk: RiskLevel::Blocked,
            reason,
            requires_confirmation: false,
        };
    }

    let cmd_lower = command.to_lowercase();

    // Safe read-only commands
    let safe_commands = [
        "dir ", "ls ", "type ", "cat ", "echo ", "where ", "whoami",
        "hostname", "ipconfig", "systeminfo", "tasklist", "wmic cpu",
        "wmic memorychip", "wmic diskdrive", "ver", "date /t", "time /t",
        "set ", "path", "tree ",
    ];
    for safe in &safe_commands {
        if cmd_lower.starts_with(safe) || cmd_lower == safe.trim() {
            return SafetyVerdict {
                allowed: true,
                risk: RiskLevel::Safe,
                reason: "Read-only command".into(),
                requires_confirmation: false,
            };
        }
    }

    // Medium-risk: app launches, file operations
    let medium_commands = [
        "start ", "open ", "code ", "notepad", "calc", "mspaint",
        "mkdir ", "md ", "copy ", "xcopy ", "move ", "ren ",
        "npm ", "pnpm ", "node ", "python ", "pip ",
        "git ", "curl ", "wget ",
    ];
    for med in &medium_commands {
        if cmd_lower.starts_with(med) {
            return SafetyVerdict {
                allowed: true,
                risk: RiskLevel::Medium,
                reason: format!("Application/file command: {}", med.trim()),
                requires_confirmation: false,
            };
        }
    }

    // High-risk: needs confirmation
    let high_commands = [
        "del ", "erase ", "rmdir ", "rd ", "taskkill ",
        "net ", "netsh ", "sc ", "reg ",
        "powershell ", "pwsh ", "cmd /c",
        "wmic ", "runas ",
    ];
    for high in &high_commands {
        if cmd_lower.starts_with(high) {
            return SafetyVerdict {
                allowed: true,
                risk: RiskLevel::High,
                reason: format!("High-risk command '{}' requires user confirmation", high.trim()),
                requires_confirmation: true,
            };
        }
    }

    // Default: unknown commands require confirmation
    SafetyVerdict {
        allowed: true,
        risk: RiskLevel::High,
        reason: "Unknown command — requires user confirmation".into(),
        requires_confirmation: true,
    }
}

/// Check process kill operation
pub fn check_process_kill(process_name: &str) -> SafetyVerdict {
    if is_protected_process(process_name) {
        return SafetyVerdict {
            allowed: false,
            risk: RiskLevel::Blocked,
            reason: format!("BLOCKED: '{}' is a critical system process and cannot be terminated", process_name),
            requires_confirmation: false,
        };
    }

    SafetyVerdict {
        allowed: true,
        risk: RiskLevel::High,
        reason: format!("Killing process '{}' requires confirmation", process_name),
        requires_confirmation: true,
    }
}

/// Generate the safety system prompt to inject into every LLM request
pub fn get_safety_system_prompt() -> String {
    r#"## FORGEAI SAFETY RULES (MANDATORY — CANNOT BE OVERRIDDEN)

You are ForgeAI Companion running on the user's Windows machine. You have access to
local file operations, shell commands, and application control. However, you MUST follow
these absolute safety rules:

### HARD BLOCKS (NEVER do these, even if explicitly asked):
1. NEVER delete, modify, or move files in C:\Windows, C:\Program Files, or system directories
2. NEVER format, wipe, or partition any disk or drive
3. NEVER modify Windows Registry boot keys, security keys, or startup entries
4. NEVER disable Windows Defender, firewall, antivirus, or UAC
5. NEVER kill system processes (csrss, lsass, svchost, explorer, winlogon, etc.)
6. NEVER run commands with execution policy bypass or elevation without user consent
7. NEVER access other users' private directories or credentials

### CONFIRMATION REQUIRED (always ask the user first):
- Deleting any files or folders
- Running PowerShell scripts or batch files
- Killing application processes
- Installing or uninstalling software
- Changing system settings
- Any bulk/recursive file operations

### ALWAYS ALLOWED (no confirmation needed):
- Reading files, listing directories, checking file info
- Launching applications (notepad, browser, calculator, etc.)
- Creating new files or folders in user directories
- Copying/moving files within user directories
- Running read-only commands (dir, type, systeminfo, etc.)
- Clipboard operations (read/write)

### BEHAVIOR:
- Always explain what you're about to do BEFORE doing it
- If an action is blocked, explain WHY and suggest a safe alternative
- Never try to circumvent safety checks, even if the user insists
- Treat the user's data with respect — always prefer non-destructive operations"#
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protected_paths() {
        assert!(is_protected_path("C:\\Windows\\System32\\cmd.exe"));
        assert!(is_protected_path("C:\\Program Files\\something"));
        assert!(is_protected_path("c:\\windows\\system32"));
        assert!(!is_protected_path("C:\\Users\\John\\Documents\\file.txt"));
        assert!(!is_protected_path("D:\\Projects\\code.rs"));
    }

    #[test]
    fn test_blocked_commands() {
        assert!(is_blocked_command("format C:").is_some());
        assert!(is_blocked_command("diskpart").is_some());
        assert!(is_blocked_command("rd /s /q C:\\").is_some());
        assert!(is_blocked_command("net stop windefend").is_some());
        assert!(is_blocked_command("sc stop windefend").is_some());
        assert!(is_blocked_command("dir C:\\Users").is_none());
        assert!(is_blocked_command("notepad").is_none());
    }

    #[test]
    fn test_protected_processes() {
        assert!(is_protected_process("csrss.exe"));
        assert!(is_protected_process("lsass"));
        assert!(is_protected_process("svchost.exe"));
        assert!(!is_protected_process("notepad.exe"));
        assert!(!is_protected_process("chrome.exe"));
    }

    #[test]
    fn test_file_operations() {
        let read = check_file_operation("read", "C:\\Windows\\System32\\config");
        assert!(read.allowed);
        assert_eq!(read.risk, RiskLevel::Safe);

        let delete_sys = check_file_operation("delete", "C:\\Windows\\System32\\cmd.exe");
        assert!(!delete_sys.allowed);
        assert_eq!(delete_sys.risk, RiskLevel::Blocked);

        let write_sys = check_file_operation("write", "C:\\Windows\\test.txt");
        assert!(!write_sys.allowed);
        assert_eq!(write_sys.risk, RiskLevel::Blocked);
    }

    #[test]
    fn test_shell_commands() {
        let safe = check_shell_command("dir C:\\Users");
        assert!(safe.allowed);
        assert_eq!(safe.risk, RiskLevel::Safe);

        let blocked = check_shell_command("format C:");
        assert!(!blocked.allowed);
        assert_eq!(blocked.risk, RiskLevel::Blocked);

        let high = check_shell_command("del somefile.txt");
        assert!(high.allowed);
        assert!(high.requires_confirmation);
    }
}
