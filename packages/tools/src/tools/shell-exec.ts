import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { DEFAULT_GATEWAY_PORT, DEFAULT_WS_PORT } from '@forgeai/shared';

// ─── Security: hard-blocked patterns that would DESTROY the OS ───
// Only truly catastrophic, irreversible commands. Everything else is allowed.
// The agent can do ANYTHING else — install software, modify configs, run servers, etc.
const HARD_BLOCKED_PATTERNS = [
  // Linux: wipe root filesystem
  'rm -rf /',
  'rm -rf /*',
  'rm -rf --no-preserve-root',
  // Linux: fork bomb
  ':(){:|:&};:',
  // Linux: overwrite disk/MBR/partitions
  'dd if=/dev/zero of=/dev/sd',
  'dd if=/dev/random of=/dev/sd',
  'dd if=/dev/zero of=/dev/nvme',
  'dd if=/dev/zero of=/dev/hd',
  'dd if=/dev/zero of=/dev/vd',
  // Linux: destroy boot
  'rm -rf /boot',
  'rm -rf /etc',
  'rm -rf /usr',
  'rm -rf /var',
  'rm -rf /lib',
  // Linux: partition wipe
  'wipefs -a /dev/',
  'mkfs.ext4 /dev/sd',
  'mkfs.ext4 /dev/nvme',
  // Windows: wipe system drive
  'format c:',
  'format d:',
  'rd /s /q c:\\',
  'rd /s /q c:/',
  'del /f /s /q c:\\',
  'del /f /s /q c:/',
  'rmdir /s /q c:\\',
  // Windows: corrupt boot loader
  'bcdedit /deletevalue',
  'bcdedit /delete',
  // Windows: destroy system32
  'del /f /s /q c:\\windows\\system32',
  'rd /s /q c:\\windows\\system32',
  'del /f /s /q c:\\windows',
  'rd /s /q c:\\windows',
  // Windows: destroy user profiles
  'rd /s /q c:\\users',
  'del /f /s /q c:\\users',
  // Windows: disk partition manipulation
  'diskpart',
  'clean all',
  // Windows: destroy registry
  'reg delete hklm\\system',
  'reg delete hklm\\software',
  'reg delete hklm\\sam',
  // Credential theft tools
  'mimikatz',
  'sekurlsa',
  'hashdump',
  'lazagne',
  // Kill signal to ALL processes
  'kill -9 -1',
  'taskkill /f /im csrss',
  'taskkill /f /im wininit',
  'taskkill /f /im smss',
  // Ransomware-like patterns
  'cipher /w:c:',
];

// Regex patterns for more sophisticated matching
const HARD_BLOCKED_REGEX = [
  // Linux: rm -rf on root-level system directories
  /rm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:boot|etc|usr|var|lib|bin|sbin|proc|sys)\b/i,
  // Windows: format any drive letter
  /format\s+[a-z]:/i,
  // Windows: recursive delete on drive root
  /(?:rd|rmdir|del)\s+.*\/s.*[a-z]:\\/i,
  // dd to any block device
  /dd\s+.*of=\/dev\/(?:sd|hd|nvme|vd|loop)/i,
  // mkfs on real devices
  /mkfs\.\w+\s+\/dev\/(?:sd|hd|nvme|vd)/i,
  // Windows: wipe system directories (c:\windows, system32)
  /(?:remove-item|del|rd|rmdir)\s+.*(?:c:\\windows|system32)/i,
  // Windows: wipe ALL user profiles (only blocks c:\users root, NOT c:\users\<name>\subdir)
  /(?:remove-item|del|rd|rmdir)\s+[^\S]*["']?c:\\users["']?\s*(?:$|[-\/;|&>])/i,
];

// Patterns that are logged as HIGH RISK but always allowed (just audit trail)
const HIGH_RISK_PATTERNS = [
  'rm -rf',
  'format',
  'diskpart',
  'reg delete',
  'powershell -enc',
];

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB — assistant needs full output
const DEFAULT_TIMEOUT = 300_000; // 5 minutes — npm install, docker build, etc.

const IS_WINDOWS = process.platform === 'win32';

// ─── Self-Protection: prevent the agent from killing ForgeAI itself ───
// Dynamically detect ForgeAI's own PIDs and ports at runtime so the agent
// can never shut down its own host process or hijack its reserved ports.
function getProtectedPIDs(): number[] {
  return [process.pid, process.ppid].filter((p): p is number => typeof p === 'number' && p > 0);
}

function getProtectedPorts(): number[] {
  const gatewayPort = Number(process.env['GATEWAY_PORT']) || DEFAULT_GATEWAY_PORT;
  const wsPort = Number(process.env['WS_PORT']) || DEFAULT_WS_PORT;
  return [gatewayPort, wsPort];
}

// Regex builders for self-protection detection
function buildProcessKillRegexes(pids: number[]): RegExp[] {
  const regexes: RegExp[] = [];
  for (const pid of pids) {
    const p = String(pid);
    // PowerShell: Stop-Process -Id <PID> (with optional -Force)
    regexes.push(new RegExp(`stop-process\\s+.*-id\\s+${p}\\b`, 'i'));
    // Windows: taskkill /pid <PID>
    regexes.push(new RegExp(`taskkill\\s+.*/?pid\\s+${p}\\b`, 'i'));
    // Linux: kill <PID>, kill -9 <PID>, kill -SIGKILL <PID>
    regexes.push(new RegExp(`(?:^|[;&|])\\s*kill\\s+(?:-\\w+\\s+)*${p}\\b`, 'i'));
  }
  return regexes;
}

function buildPortKillRegexes(ports: number[]): RegExp[] {
  const regexes: RegExp[] = [];
  for (const port of ports) {
    const p = String(port);
    // PowerShell: Get-NetTCPConnection -LocalPort <PORT> ... | Stop-Process
    regexes.push(new RegExp(`get-nettcpconnection.*-localport\\s+${p}.*stop-process`, 'i'));
    // Linux: fuser -k <PORT>/tcp
    regexes.push(new RegExp(`fuser\\s+.*-k\\s+${p}/tcp`, 'i'));
    regexes.push(new RegExp(`fuser\\s+-k\\s+${p}`, 'i'));
    // Linux: lsof -ti:<PORT> | xargs kill
    regexes.push(new RegExp(`lsof\\s+.*-ti:${p}.*kill`, 'i'));
    // npx kill-port <PORT>
    regexes.push(new RegExp(`kill-port\\s+${p}\\b`, 'i'));
    // PowerShell: piped port lookup to Stop-Process
    regexes.push(new RegExp(`localport.*${p}.*stop-process`, 'i'));
    regexes.push(new RegExp(`stop-process.*localport.*${p}`, 'i'));
  }
  return regexes;
}

// Patterns that kill ALL Node.js processes (which would include ForgeAI)
const KILL_ALL_NODE_REGEX = [
  /taskkill\s+.*\/im\s+node\.exe/i,
  /killall\s+node\b/i,
  /pkill\s+(-\w+\s+)*node\b/i,
  /stop-process\s+.*-name\s+['"]?node['"]?/i,
  /wmic\s+.*node\.exe.*delete/i,
  /get-process\s+.*node.*\|.*stop-process/i,
];

// ─── Host command rate limiter (10 commands/minute) ───
const HOST_RATE_LIMIT = 10;
const HOST_RATE_WINDOW_MS = 60_000;
const hostCommandTimestamps: number[] = [];

function checkHostRateLimit(): boolean {
  const now = Date.now();
  // Remove timestamps older than the window
  while (hostCommandTimestamps.length > 0 && hostCommandTimestamps[0]! < now - HOST_RATE_WINDOW_MS) {
    hostCommandTimestamps.shift();
  }
  if (hostCommandTimestamps.length >= HOST_RATE_LIMIT) {
    return false;
  }
  hostCommandTimestamps.push(now);
  return true;
}

export class ShellExecTool extends BaseTool {
  private workDir: string;

  readonly definition: ToolDefinition = {
    name: 'shell_exec',
    description: `Execute shell commands with full system access. The agent runs with admin/root privileges.
Use this for: npm, git, python, node, docker, system config, package installs, service management, file operations anywhere on disk, and any CLI tool.
Default working directory is .forgeai/workspace/ but you can set cwd to any absolute path.
On Windows: uses PowerShell. On Linux: uses /bin/bash.
Target options: "server" (default, inside Docker), "host" (directly on the VPS/host machine — use for installing packages with apt, running systemctl, Python, etc.), "companion" (user's Windows PC).
Security: destructive OS-level commands (format C:, rm -rf /, fork bombs) are blocked. All commands are audit-logged.`,
    category: 'utility',
    dangerous: true,
    parameters: [
      { name: 'command', type: 'string', description: 'Shell command to execute (e.g. "npm init -y", "dir", "node index.js", "docker ps")', required: true },
      { name: 'cwd', type: 'string', description: 'Working directory. Relative paths resolve from workspace. Absolute paths (e.g. "C:\\Users" or "/home") are allowed.', required: false },
      { name: 'timeout', type: 'number', description: 'Timeout in ms (default: 60000). Set higher for long tasks like npm install.', required: false },
      { name: 'target', type: 'string', description: 'Where to execute: "server" (default, inside Docker container), "host" (directly on the VPS/host machine — use for apt install, systemctl, Python, services, anything that needs the real OS), or "companion" (user\'s Windows PC via ForgeAI Companion).', required: false },
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
    const target = String(params['target'] || 'server').toLowerCase();

    // ─── Host execution: target="host" uses nsenter to run on the VPS directly ───
    const isHostTarget = target === 'host';

    // ─── Host rate limit: max 10 host commands per minute ───
    if (isHostTarget && !checkHostRateLimit()) {
      this.logger.warn('Host command rate limit exceeded', { command });
      return {
        success: false,
        error: `⚠️ Host command rate limit exceeded (max ${HOST_RATE_LIMIT}/minute). Wait a moment before running more host commands.`,
        duration: 0,
      };
    }

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

    // ─── Security Layer 1b: Regex-based pattern matching ───
    for (const regex of HARD_BLOCKED_REGEX) {
      if (regex.test(command)) {
        this.logger.warn('BLOCKED destructive command (regex)', { command, pattern: regex.source });
        return {
          success: false,
          error: `🛡️ BLOCKED: This command matches a destructive OS pattern. Disk formatting, partition wiping, and system file destruction are not allowed.`,
          duration: 0,
        };
      }
    }

    // ─── Security Layer 2: Self-Protection (ForgeAI process & port) ───
    const selfProtectBlock = this.checkSelfProtection(command);
    if (selfProtectBlock) {
      return selfProtectBlock;
    }

    // ─── Security Layer 3: Flag high-risk commands (allowed but logged) ───
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

    const { result, duration } = await this.timed(() => this.runCommand(command, cwd, timeout, isHostTarget));

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

  private runCommand(command: string, cwd: string, timeout: number, isHostTarget = false): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      let shell: string;
      let shellArgs: string[];

      if (isHostTarget && !IS_WINDOWS) {
        // ─── Host execution via nsenter ───
        // nsenter -t 1 -m -u -i -n enters the host's mount/UTS/IPC/net namespaces
        // This effectively runs the command directly on the host machine as root
        const escapedCmd = command.replace(/'/g, "'\\''");
        const hostCmd = cwd && cwd !== this.workDir
          ? `cd '${cwd.replace(/'/g, "'\\''")}' 2>/dev/null; ${escapedCmd}`
          : escapedCmd;
        shell = '/usr/bin/nsenter';
        shellArgs = ['-t', '1', '-m', '-u', '-i', '-n', '--', '/bin/bash', '-c', hostCmd];
        this.logger.info('Executing on HOST via nsenter', { command: command.substring(0, 200) });
      } else {
        // Windows: PowerShell for admin capabilities
        // Linux: /bin/bash for full shell features (inside Docker)
        shell = IS_WINDOWS ? 'powershell.exe' : '/bin/bash';
        shellArgs = IS_WINDOWS
          ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
          : ['-c', command];
      }

      const proc = execFile(shell, shellArgs, {
        cwd: isHostTarget ? undefined : cwd,
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

  private checkSelfProtection(command: string): ToolResult | null {
    const protectedPIDs = getProtectedPIDs();
    const protectedPorts = getProtectedPorts();

    // 1. Block killing ForgeAI by PID
    const pidRegexes = buildProcessKillRegexes(protectedPIDs);
    for (const regex of pidRegexes) {
      if (regex.test(command)) {
        this.logger.warn('BLOCKED: attempt to kill ForgeAI process', { command, pids: protectedPIDs });
        return {
          success: false,
          error: `🛡️ SELF-PROTECTION: This command would kill the ForgeAI process (PID ${protectedPIDs.join('/')}). ` +
                 `The agent cannot shut down its own host. Use a different PID or approach.`,
          duration: 0,
        };
      }
    }

    // 2. Block killing ALL Node.js processes (ForgeAI runs on Node)
    for (const regex of KILL_ALL_NODE_REGEX) {
      if (regex.test(command)) {
        this.logger.warn('BLOCKED: attempt to kill all Node processes', { command });
        return {
          success: false,
          error: `🛡️ SELF-PROTECTION: This command would kill ALL Node.js processes, including ForgeAI itself. ` +
                 `To stop a specific Node process, use its PID instead (but not ForgeAI's PID: ${protectedPIDs.join('/')}).`,
          duration: 0,
        };
      }
    }

    // 3. Block killing processes on ForgeAI's reserved ports
    const portRegexes = buildPortKillRegexes(protectedPorts);
    for (const regex of portRegexes) {
      if (regex.test(command)) {
        this.logger.warn('BLOCKED: attempt to kill process on ForgeAI port', { command, ports: protectedPorts });
        return {
          success: false,
          error: `🛡️ SELF-PROTECTION: Ports ${protectedPorts.join(' and ')} are reserved for ForgeAI (gateway/websocket). ` +
                 `The agent cannot kill processes on these ports. Use a different port for your server.`,
          duration: 0,
        };
      }
    }

    // 4. Warn (but allow) if command tries to listen on ForgeAI's port
    //    (it would fail with EADDRINUSE anyway, but give a helpful message)
    for (const port of protectedPorts) {
      const listenPattern = new RegExp(
        `(?:--port|\\s-p)\\s+${port}\\b|` +
        `listen\\s*\\(\\s*${port}\\b|` +
        `serve\\s+.*-l\\s+${port}\\b`,
        'i'
      );
      if (listenPattern.test(command)) {
        this.logger.warn('Command may conflict with ForgeAI port', { command, port });
      }
    }

    return null;
  }

  getWorkDir(): string {
    return this.workDir;
  }
}
