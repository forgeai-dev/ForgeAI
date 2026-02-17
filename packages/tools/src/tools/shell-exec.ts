import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

// ─── Security: hard-blocked patterns that could brick the OS ───
// These are ALWAYS blocked regardless of admin mode.
const HARD_BLOCKED_PATTERNS = [
  // Linux: wipe root filesystem
  'rm -rf /',
  'rm -rf /*',
  'rm -rf --no-preserve-root',
  // Linux: fork bomb
  ':(){:|:&};:',
  // Linux: overwrite disk/MBR
  'dd if=/dev/zero of=/dev/sd',
  'dd if=/dev/random of=/dev/sd',
  'mkfs.ext',
  'mkfs.xfs',
  'mkfs.btrfs',
  // Windows: wipe system drive
  'format c:',
  'format d:',
  'rd /s /q c:\\',
  'rd /s /q c:/',
  'del /f /s /q c:\\',
  'del /f /s /q c:/',
  'rmdir /s /q c:\\',
  // Windows: corrupt boot
  'bcdedit /deletevalue',
  'bcdedit /delete',
  // Both: shutdown/reboot (accidental)
  'shutdown /s',
  'shutdown /r',
  'shutdown -h',
  'shutdown -r',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  // Registry destruction
  'reg delete hklm',
  'reg delete hkcr',
  // Credential theft
  'mimikatz',
  'sekurlsa',
  'hashdump',
  // Kill all node processes (would kill the gateway itself)
  'stop-process -name node',
  'get-process -name node',
  'get-process node',
  'taskkill /im node',
  'taskkill /f /im node',
  'killall node',
  'pkill node',
  'pkill -f node',
  'kill -9 -1',
];

// Patterns that are logged as HIGH RISK but still allowed (admin has power)
const HIGH_RISK_PATTERNS = [
  'rm -rf',
  'del /f',
  'rd /s',
  'rmdir /s',
  'format',
  'diskpart',
  'net user',
  'net localgroup',
  'netsh',
  'reg add',
  'reg delete',
  'chmod 777',
  'chown root',
  'iptables',
  'ufw',
  'systemctl stop',
  'systemctl disable',
  'kill -9',
  'taskkill',
  'sc delete',
  'sc stop',
  'pip install',
  'npm install -g',
  'curl | bash',
  'curl | sh',
  'wget -O - |',
  'powershell -enc',
  'powershell -e ',
  'iex(',
  'invoke-expression',
];

const MAX_OUTPUT_SIZE = 128 * 1024; // 128KB (generous for admin tasks)
const DEFAULT_TIMEOUT = 60_000; // 60s (admin tasks may take longer)

const IS_WINDOWS = process.platform === 'win32';

export class ShellExecTool extends BaseTool {
  private workDir: string;

  readonly definition: ToolDefinition = {
    name: 'shell_exec',
    description: `Execute shell commands with full system access. The agent runs with admin/root privileges on this machine.
Use this for: npm, git, python, node, docker, system config, package installs, service management, file operations anywhere on disk, and any CLI tool.
Default working directory is .forgeai/workspace/ but you can set cwd to any absolute path.
On Windows: uses PowerShell. On Linux: uses /bin/bash.
Security: destructive OS-level commands (format C:, rm -rf /, fork bombs) are blocked. All commands are audit-logged.`,
    category: 'utility',
    dangerous: true,
    parameters: [
      { name: 'command', type: 'string', description: 'Shell command to execute (e.g. "npm init -y", "dir", "node index.js", "docker ps")', required: true },
      { name: 'cwd', type: 'string', description: 'Working directory. Relative paths resolve from workspace. Absolute paths (e.g. "C:\\Users" or "/home") are allowed.', required: false },
      { name: 'timeout', type: 'number', description: 'Timeout in ms (default: 60000). Set higher for long tasks like npm install.', required: false },
    ],
  };

  constructor(workDir?: string) {
    super();
    this.workDir = workDir || resolve(process.cwd(), '.forgeai', 'workspace');
    if (!existsSync(this.workDir)) {
      mkdir(this.workDir, { recursive: true }).catch(() => {});
    }
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const command = String(params['command']).trim();
    const cwdParam = params['cwd'] ? String(params['cwd']).trim() : '';
    const timeout = Number(params['timeout']) || DEFAULT_TIMEOUT;

    // ─── Security Layer 1: Hard-block destructive OS commands ───
    const lowerCmd = command.toLowerCase().replace(/\s+/g, ' ');
    for (const blocked of HARD_BLOCKED_PATTERNS) {
      if (lowerCmd.includes(blocked.toLowerCase())) {
        this.logger.warn('BLOCKED destructive command', { command, pattern: blocked });
        return {
          success: false,
          error: `🛡️ BLOCKED: This command matches a destructive pattern ("${blocked}"). This protection cannot be bypassed.`,
          duration: 0,
        };
      }
    }

    // ─── Security Layer 2: Flag high-risk commands (allowed but logged) ───
    const risks: string[] = [];
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (lowerCmd.includes(pattern.toLowerCase())) {
        risks.push(pattern);
      }
    }
    if (risks.length > 0) {
      this.logger.warn('HIGH-RISK command executed', { command, risks, user: 'agent' });
    }

    // ─── Resolve working directory ───
    let cwd: string;
    if (cwdParam && (cwdParam.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwdParam))) {
      // Absolute path — allow anywhere on the system
      cwd = resolve(cwdParam);
    } else if (cwdParam) {
      // Relative path — resolve from workspace
      cwd = resolve(this.workDir, cwdParam);
    } else {
      cwd = this.workDir;
    }

    // Ensure cwd exists (create if in workspace, error if outside)
    if (!existsSync(cwd)) {
      if (cwd.startsWith(this.workDir)) {
        await mkdir(cwd, { recursive: true });
      } else {
        return { success: false, error: `Directory does not exist: ${cwd}`, duration: 0 };
      }
    }

    const { result, duration } = await this.timed(() => this.runCommand(command, cwd, timeout));

    this.logger.debug('Shell command executed', {
      command: command.substring(0, 200),
      cwd,
      duration,
      exitCode: result.exitCode,
      risks: risks.length > 0 ? risks : undefined,
    });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || result.stdout || `Command exited with code ${result.exitCode}`,
        data: result,
        duration,
      };
    }

    return {
      success: true,
      data: result,
      duration,
    };
  }

  private runCommand(command: string, cwd: string, timeout: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      // Windows: PowerShell for admin capabilities
      // Linux: /bin/bash for full shell features
      const shell = IS_WINDOWS ? 'powershell.exe' : '/bin/bash';
      const shellArgs = IS_WINDOWS
        ? ['-NoProfile', '-NonInteractive', '-Command', command]
        : ['-c', command];

      const proc = execFile(shell, shellArgs, {
        cwd,
        timeout,
        maxBuffer: MAX_OUTPUT_SIZE,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          // Ensure PowerShell uses UTF-8
          ...(IS_WINDOWS ? { PYTHONIOENCODING: 'utf-8' } : {}),
        },
      }, (error, stdout, stderr) => {
        const isTimeout = error && (error as NodeJS.ErrnoException & { code?: string }).code === 'ETIMEDOUT';

        const truncate = (s: string) => s.length > MAX_OUTPUT_SIZE
          ? s.substring(0, MAX_OUTPUT_SIZE) + '\n... (truncated)'
          : s;

        resolve({
          stdout: truncate(stdout || ''),
          stderr: truncate(stderr || ''),
          exitCode: isTimeout ? -1 : (proc.exitCode ?? (error ? 1 : 0)),
        });
      });
    });
  }

  getWorkDir(): string {
    return this.workDir;
  }
}
