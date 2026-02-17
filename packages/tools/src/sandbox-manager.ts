import { createLogger } from '@forgeai/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const logger = createLogger('Tools:SandboxManager');

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  memoryLimit: string;
  cpuLimit: string;
  timeoutSeconds: number;
  networkMode: string;
  workdir: string;
}

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
  containerId?: string;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: false,
  image: 'node:22-slim',
  memoryLimit: '256m',
  cpuLimit: '0.5',
  timeoutSeconds: 30,
  networkMode: 'none',
  workdir: '/sandbox',
};

export class SandboxManager {
  private config: SandboxConfig;
  private dockerAvailable: boolean | null = null;
  private activeContainers: Set<string> = new Set();

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('Sandbox manager initialized', {
      enabled: this.config.enabled,
      image: this.config.image,
    });
  }

  async checkDocker(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    try {
      await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}']);
      this.dockerAvailable = true;
      logger.info('Docker is available');
    } catch {
      this.dockerAvailable = false;
      logger.warn('Docker is not available — sandbox mode disabled');
    }
    return this.dockerAvailable;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  async execute(code: string, language: string = 'javascript'): Promise<SandboxResult> {
    const start = Date.now();

    if (!this.config.enabled) {
      return {
        success: false,
        output: '',
        error: 'Sandbox mode is disabled. Enable it in config or use SANDBOX_ENABLED=true',
        exitCode: -1,
        durationMs: Date.now() - start,
      };
    }

    const isDockerOk = await this.checkDocker();
    if (!isDockerOk) {
      return {
        success: false,
        output: '',
        error: 'Docker is not available on this system',
        exitCode: -1,
        durationMs: Date.now() - start,
      };
    }

    const containerId = `forgeai-sandbox-${randomUUID().slice(0, 8)}`;

    const cmd = language === 'javascript'
      ? ['node', '-e', code]
      : language === 'python'
        ? ['python3', '-c', code]
        : ['sh', '-c', code];

    const image = language === 'python' ? 'python:3.12-slim' : this.config.image;

    const args = [
      'run',
      '--rm',
      '--name', containerId,
      '--memory', this.config.memoryLimit,
      '--cpus', this.config.cpuLimit,
      '--network', this.config.networkMode,
      '--workdir', this.config.workdir,
      '--read-only',
      '--no-new-privileges',
      '--security-opt', 'no-new-privileges:true',
      image,
      ...cmd,
    ];

    this.activeContainers.add(containerId);

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: this.config.timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
      });

      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        exitCode: 0,
        durationMs: Date.now() - start,
        containerId,
      };
    } catch (err: unknown) {
      const error = err as { code?: string; stdout?: string; stderr?: string; killed?: boolean };
      const isTimeout = error.killed || error.code === 'ERR_CHILD_PROCESS_TIMEOUT';

      if (isTimeout) {
        // Force kill container on timeout
        try { await execFileAsync('docker', ['kill', containerId]); } catch { /* ignore */ }
      }

      return {
        success: false,
        output: error.stdout ?? '',
        error: isTimeout
          ? `Execution timed out after ${this.config.timeoutSeconds}s`
          : (error.stderr ?? String(err)),
        exitCode: isTimeout ? 124 : 1,
        durationMs: Date.now() - start,
        containerId,
      };
    } finally {
      this.activeContainers.delete(containerId);
    }
  }

  async cleanup(): Promise<number> {
    let cleaned = 0;
    for (const id of this.activeContainers) {
      try {
        await execFileAsync('docker', ['rm', '-f', id]);
        cleaned++;
      } catch { /* ignore */ }
    }
    this.activeContainers.clear();
    if (cleaned > 0) logger.info('Cleaned up sandbox containers', { cleaned });
    return cleaned;
  }

  getActiveContainers(): string[] {
    return Array.from(this.activeContainers);
  }

  async getStatus(): Promise<{
    enabled: boolean;
    dockerAvailable: boolean;
    activeContainers: number;
    config: SandboxConfig;
  }> {
    return {
      enabled: this.config.enabled,
      dockerAvailable: await this.checkDocker(),
      activeContainers: this.activeContainers.size,
      config: this.getConfig(),
    };
  }
}

export function createSandboxManager(config?: Partial<SandboxConfig>): SandboxManager {
  return new SandboxManager(config);
}
