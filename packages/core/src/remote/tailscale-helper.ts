import { createLogger } from '@forgeai/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const logger = createLogger('Core:Tailscale');

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  ip?: string;
  hostname?: string;
  dns?: string;
  funnel?: boolean;
  serveUrl?: string;
}

export interface TailscaleServeConfig {
  port: number;
  funnel?: boolean;
  https?: boolean;
}

export class TailscaleHelper {
  private status: TailscaleStatus = { installed: false, running: false };

  constructor() {
    logger.info('Tailscale helper initialized');
  }

  async checkStatus(): Promise<TailscaleStatus> {
    try {
      const { stdout: versionOut } = await exec('tailscale', ['version'], { timeout: 5000 });
      this.status.installed = true;
      this.status.version = versionOut.trim().split('\n')[0];

      const { stdout: statusOut } = await exec('tailscale', ['status', '--json'], { timeout: 5000 });
      const statusData = JSON.parse(statusOut) as {
        Self?: { TailscaleIPs?: string[]; HostName?: string; DNSName?: string; Online?: boolean };
      };

      if (statusData.Self) {
        this.status.running = statusData.Self.Online ?? true;
        this.status.ip = statusData.Self.TailscaleIPs?.[0];
        this.status.hostname = statusData.Self.HostName;
        this.status.dns = statusData.Self.DNSName;
      }
    } catch {
      this.status.installed = false;
      this.status.running = false;
    }

    return { ...this.status };
  }

  async serve(config: TailscaleServeConfig): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!this.status.installed) {
      return { success: false, error: 'Tailscale not installed' };
    }

    try {
      const args = ['serve'];
      if (config.https !== false) args.push('--https=443');
      if (config.funnel) args.push('--bg');
      args.push(`${config.port}`);

      await exec('tailscale', args, { timeout: 10000 });
      const url = `https://${this.status.dns ?? this.status.hostname ?? 'unknown'}`;
      this.status.serveUrl = url;

      if (config.funnel) {
        try {
          await exec('tailscale', ['funnel', '--bg', `${config.port}`], { timeout: 10000 });
          this.status.funnel = true;
        } catch (err) {
          logger.warn('Funnel failed (may require ACL)', { error: String(err) });
        }
      }

      return { success: true, url };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async stopServe(): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('tailscale', ['serve', '--remove', '/'], { timeout: 5000 });
      this.status.serveUrl = undefined;
      this.status.funnel = false;
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  getStatus(): TailscaleStatus {
    return { ...this.status };
  }
}

export function createTailscaleHelper(): TailscaleHelper {
  return new TailscaleHelper();
}
