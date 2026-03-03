import { createLogger } from '@forgeai/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const logger = createLogger('Gateway:AppManager');

export interface ManagedApp {
  name: string;
  port: number;
  cwd: string;
  command: string;
  args: string[];
  description?: string;
  createdAt: string;
  status: 'running' | 'stopped' | 'crashed' | 'starting';
  pid?: number;
  restarts: number;
  maxRestarts: number;
  lastHealthCheck?: string;
  lastError?: string;
  process?: ChildProcess;
  startedAt?: string;
  stoppedAt?: string;
}

export interface AppManagerConfig {
  healthCheckIntervalMs?: number;
  maxRestarts?: number;
  restartDelayMs?: number;
  healthCheckTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<AppManagerConfig> = {
  healthCheckIntervalMs: 30_000,
  maxRestarts: 5,
  restartDelayMs: 3_000,
  healthCheckTimeoutMs: 5_000,
};

/**
 * Manages agent-created app processes with health checks and auto-restart.
 * Replaces fragile `node server.js &` pattern with proper process management.
 */
export class AppManager {
  private apps: Map<string, ManagedApp> = new Map();
  private config: Required<AppManagerConfig>;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: AppManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.healthCheckInterval = setInterval(() => this.healthCheckAll(), this.config.healthCheckIntervalMs);
    logger.info('AppManager initialized', {
      healthCheckIntervalMs: this.config.healthCheckIntervalMs,
      maxRestarts: this.config.maxRestarts,
    });
  }

  /**
   * Register and start a managed app.
   */
  async startApp(params: {
    name: string;
    port: number;
    cwd: string;
    command: string;
    args?: string[];
    description?: string;
    maxRestarts?: number;
  }): Promise<{ success: boolean; error?: string; app?: Omit<ManagedApp, 'process'> }> {
    const { name, port, cwd, command, description } = params;
    const args = params.args ?? [];

    // Validate
    if (this.apps.has(name)) {
      const existing = this.apps.get(name)!;
      if (existing.status === 'running') {
        return { success: false, error: `App "${name}" is already running on port ${existing.port}` };
      }
      // If stopped/crashed, remove and re-register
      this.stopAppProcess(existing);
      this.apps.delete(name);
    }

    // Check port conflict
    for (const [appName, app] of this.apps) {
      if (app.port === port && app.status === 'running') {
        return { success: false, error: `Port ${port} already in use by app "${appName}"` };
      }
    }

    const fullCwd = resolve(cwd);
    if (!existsSync(fullCwd)) {
      return { success: false, error: `Working directory does not exist: ${fullCwd}` };
    }

    const managedApp: ManagedApp = {
      name,
      port,
      cwd: fullCwd,
      command,
      args,
      description,
      createdAt: new Date().toISOString(),
      status: 'starting',
      restarts: 0,
      maxRestarts: params.maxRestarts ?? this.config.maxRestarts,
    };

    this.apps.set(name, managedApp);

    const started = await this.spawnProcess(managedApp);
    if (!started) {
      managedApp.status = 'crashed';
      return { success: false, error: `Failed to start app "${name}": ${managedApp.lastError}` };
    }

    // Wait briefly and verify the process is still alive
    await new Promise(r => setTimeout(r, 2000));
    if (managedApp.status !== 'running') {
      return { success: false, error: `App "${name}" exited immediately: ${managedApp.lastError}` };
    }

    // Verify port is actually responding
    const healthy = await this.healthCheck(managedApp);
    if (!healthy) {
      logger.warn(`App "${name}" started but port ${port} not responding yet — may need a moment to initialize`);
    }

    const { process: _, ...info } = managedApp;
    return { success: true, app: info };
  }

  /**
   * Stop a managed app.
   */
  stopApp(name: string): { success: boolean; error?: string } {
    const app = this.apps.get(name);
    if (!app) return { success: false, error: `App "${name}" not found` };

    this.stopAppProcess(app);
    app.status = 'stopped';
    app.stoppedAt = new Date().toISOString();
    logger.info(`App "${name}" stopped`, { port: app.port });
    return { success: true };
  }

  /**
   * Restart a managed app.
   */
  async restartApp(name: string): Promise<{ success: boolean; error?: string }> {
    const app = this.apps.get(name);
    if (!app) return { success: false, error: `App "${name}" not found` };

    this.stopAppProcess(app);
    app.restarts = 0; // Reset restart counter on manual restart
    const started = await this.spawnProcess(app);
    return started ? { success: true } : { success: false, error: app.lastError };
  }

  /**
   * Remove a managed app completely.
   */
  removeApp(name: string): boolean {
    const app = this.apps.get(name);
    if (!app) return false;
    this.stopAppProcess(app);
    this.apps.delete(name);
    logger.info(`App "${name}" removed`);
    return true;
  }

  /**
   * Get all managed apps (without process references).
   */
  listApps(): Array<Omit<ManagedApp, 'process'>> {
    return Array.from(this.apps.values()).map(({ process: _, ...info }) => info);
  }

  /**
   * Get a specific app.
   */
  getApp(name: string): Omit<ManagedApp, 'process'> | undefined {
    const app = this.apps.get(name);
    if (!app) return undefined;
    const { process: _, ...info } = app;
    return info;
  }

  /**
   * Check if a specific port has a running app.
   */
  getAppByPort(port: number): Omit<ManagedApp, 'process'> | undefined {
    for (const app of this.apps.values()) {
      if (app.port === port && app.status === 'running') {
        const { process: _, ...info } = app;
        return info;
      }
    }
    return undefined;
  }

  /**
   * Spawn the actual process for an app.
   */
  private async spawnProcess(app: ManagedApp): Promise<boolean> {
    try {
      app.status = 'starting';
      app.lastError = undefined;

      const proc = spawn(app.command, app.args, {
        cwd: app.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(app.port) },
        detached: false,
      });

      app.process = proc;
      app.pid = proc.pid;
      app.startedAt = new Date().toISOString();

      // Capture stderr for error diagnosis
      let stderrBuffer = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-2000);
      });

      // Capture stdout for logs (limited)
      proc.stdout?.on('data', () => { /* drain to prevent backpressure */ });

      proc.on('exit', (code, signal) => {
        const exitInfo = code !== null ? `code ${code}` : `signal ${signal}`;
        logger.warn(`App "${app.name}" exited (${exitInfo})`, { port: app.port, restarts: app.restarts });
        app.lastError = stderrBuffer.trim().slice(-500) || `Process exited with ${exitInfo}`;
        app.pid = undefined;
        app.process = undefined;

        if (app.status !== 'stopped') {
          app.status = 'crashed';
          this.scheduleRestart(app);
        }
      });

      proc.on('error', (err) => {
        logger.error(`App "${app.name}" spawn error`, { error: err.message });
        app.lastError = err.message;
        app.status = 'crashed';
        app.process = undefined;
        app.pid = undefined;
        this.scheduleRestart(app);
      });

      app.status = 'running';
      logger.info(`App "${app.name}" started`, { port: app.port, pid: proc.pid, cwd: app.cwd });
      return true;
    } catch (err) {
      app.lastError = err instanceof Error ? err.message : String(err);
      app.status = 'crashed';
      logger.error(`Failed to spawn app "${app.name}"`, { error: app.lastError });
      return false;
    }
  }

  /**
   * Schedule auto-restart for a crashed app.
   */
  private scheduleRestart(app: ManagedApp): void {
    if (app.status === 'stopped') return; // Manually stopped, don't restart
    if (app.restarts >= app.maxRestarts) {
      logger.error(`App "${app.name}" exceeded max restarts (${app.maxRestarts}). Giving up.`, { port: app.port });
      app.status = 'crashed';
      return;
    }

    app.restarts++;
    const delay = this.config.restartDelayMs * app.restarts; // Exponential backoff

    logger.info(`Auto-restarting app "${app.name}" in ${delay}ms (attempt ${app.restarts}/${app.maxRestarts})`);

    setTimeout(async () => {
      if (app.status === 'stopped') return; // Was stopped while waiting
      await this.spawnProcess(app);
    }, delay);
  }

  /**
   * Health check a single app by probing its port.
   */
  private async healthCheck(app: ManagedApp): Promise<boolean> {
    if (app.status !== 'running') return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.healthCheckTimeoutMs);

      const res = await fetch(`http://127.0.0.1:${app.port}/`, {
        method: 'HEAD',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeout);

      const healthy = res !== null;
      app.lastHealthCheck = new Date().toISOString();

      if (!healthy && app.process && app.pid) {
        // Process alive but port not responding — might be initializing
        logger.debug(`App "${app.name}" port ${app.port} not responding`, { pid: app.pid });
      }

      return healthy;
    } catch {
      return false;
    }
  }

  /**
   * Health check all running apps.
   */
  private async healthCheckAll(): Promise<void> {
    for (const app of this.apps.values()) {
      if (app.status === 'running') {
        await this.healthCheck(app);
      }
    }
  }

  /**
   * Kill a process.
   */
  private stopAppProcess(app: ManagedApp): void {
    if (app.process) {
      try {
        app.process.kill('SIGTERM');
        // Force kill after 5s
        setTimeout(() => {
          if (app.process && !app.process.killed) {
            app.process.kill('SIGKILL');
          }
        }, 5_000);
      } catch { /* already dead */ }
      app.process = undefined;
      app.pid = undefined;
    }
  }

  /**
   * Cleanup on shutdown.
   */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    for (const app of this.apps.values()) {
      this.stopAppProcess(app);
    }
    this.apps.clear();
    logger.info('AppManager destroyed');
  }
}

export function createAppManager(config?: AppManagerConfig): AppManager {
  return new AppManager(config);
}

/**
 * Generate a user-friendly HTML error page for when an app is down.
 * Does NOT expose internal details like shell_exec or tool names.
 */
export function generateAppDownPage(port: number, appName?: string): string {
  const name = appName || `Port ${port}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Offline — ForgeAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .container {
      text-align: center;
      max-width: 480px;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1.5rem;
      opacity: 0.8;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 0.75rem;
    }
    .subtitle {
      color: #888;
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .app-name {
      display: inline-block;
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 0.25rem 0.75rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      color: #7c7cff;
      margin-bottom: 1.5rem;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #1a1014;
      border: 1px solid #3a1a2a;
      border-radius: 20px;
      padding: 0.4rem 1rem;
      font-size: 0.8rem;
      color: #ff6b6b;
    }
    .dot {
      width: 8px;
      height: 8px;
      background: #ff6b6b;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .retry-btn {
      display: inline-block;
      margin-top: 2rem;
      padding: 0.6rem 1.5rem;
      background: #1a1a2e;
      border: 1px solid #3a3a5a;
      border-radius: 8px;
      color: #aaa;
      text-decoration: none;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .retry-btn:hover {
      background: #2a2a4e;
      color: #fff;
      border-color: #5a5a8a;
    }
    .footer {
      margin-top: 3rem;
      font-size: 0.75rem;
      color: #444;
    }
    .auto-refresh {
      color: #555;
      font-size: 0.78rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⏸</div>
    <h1>Application Offline</h1>
    <div class="app-name">${escapeHtml(name)}</div>
    <p class="subtitle">
      This application is not currently running.<br>
      It may be starting up, restarting, or has stopped.
    </p>
    <div class="status">
      <div class="dot"></div>
      Offline
    </div>
    <br>
    <a class="retry-btn" onclick="location.reload()">↻ Retry</a>
    <p class="auto-refresh">Page will auto-refresh in <span id="countdown">15</span>s</p>
    <p class="footer">Powered by ForgeAI</p>
  </div>
  <script>
    let c = 15;
    const el = document.getElementById('countdown');
    setInterval(() => {
      c--;
      if (el) el.textContent = String(c);
      if (c <= 0) location.reload();
    }, 1000);
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
