import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:IPFilter');

export interface IPFilterConfig {
  enabled: boolean;
  mode: 'allowlist' | 'blocklist';
  allowlist: string[];
  blocklist: string[];
  allowPrivate: boolean;
}

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  /^0\.0\.0\.0$/,
  /^localhost$/i,
];

export class IPFilter {
  private config: IPFilterConfig;

  constructor(config?: Partial<IPFilterConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      mode: config?.mode ?? 'blocklist',
      allowlist: config?.allowlist ?? [],
      blocklist: config?.blocklist ?? [],
      allowPrivate: config?.allowPrivate ?? true,
    };

    logger.info('IP filter initialized', { enabled: this.config.enabled, mode: this.config.mode });
  }

  isAllowed(ip: string): boolean {
    if (!this.config.enabled) return true;

    const normalized = this.normalize(ip);

    if (this.config.mode === 'allowlist') {
      if (this.config.allowPrivate && this.isPrivate(normalized)) return true;
      return this.config.allowlist.some(pattern => this.matches(normalized, pattern));
    }

    // blocklist mode
    if (this.config.blocklist.some(pattern => this.matches(normalized, pattern))) return false;
    return true;
  }

  addToAllowlist(ip: string): void {
    if (!this.config.allowlist.includes(ip)) {
      this.config.allowlist.push(ip);
      logger.info('IP added to allowlist', { ip });
    }
  }

  removeFromAllowlist(ip: string): void {
    this.config.allowlist = this.config.allowlist.filter(i => i !== ip);
  }

  addToBlocklist(ip: string): void {
    if (!this.config.blocklist.includes(ip)) {
      this.config.blocklist.push(ip);
      logger.info('IP added to blocklist', { ip });
    }
  }

  removeFromBlocklist(ip: string): void {
    this.config.blocklist = this.config.blocklist.filter(i => i !== ip);
  }

  getConfig(): IPFilterConfig {
    return { ...this.config, allowlist: [...this.config.allowlist], blocklist: [...this.config.blocklist] };
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  setMode(mode: 'allowlist' | 'blocklist'): void {
    this.config.mode = mode;
  }

  private normalize(ip: string): string {
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
  }

  private isPrivate(ip: string): boolean {
    return PRIVATE_RANGES.some(r => r.test(ip));
  }

  private matches(ip: string, pattern: string): boolean {
    if (pattern.includes('/')) {
      return this.matchesCIDR(ip, pattern);
    }
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '\\d+') + '$');
      return regex.test(ip);
    }
    return ip === pattern;
  }

  private matchesCIDR(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const mask = parseInt(bits, 10);
    if (isNaN(mask)) return false;

    const ipNum = this.ipToNumber(ip);
    const rangeNum = this.ipToNumber(range);
    if (ipNum === null || rangeNum === null) return false;

    const shift = 32 - mask;
    return (ipNum >>> shift) === (rangeNum >>> shift);
  }

  private ipToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(Number);
    if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
    return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  }
}

export function createIPFilter(config?: Partial<IPFilterConfig>): IPFilter {
  return new IPFilter(config);
}
