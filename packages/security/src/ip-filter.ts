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

export interface ThreatRecord {
  ip: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  blocked: boolean;
  autoBlocked: boolean;
  reason: string;
  blockedAt?: number;
  expiresAt?: number;  // 0 = permanent
}

export class IPFilter {
  private config: IPFilterConfig;

  // Threat tracking: IP → threat record
  private threats: Map<string, ThreatRecord> = new Map();

  // Auto-block threshold: block IP after N threats within the window
  private autoBlockThreshold: number;
  private autoBlockWindowMs: number;
  private autoBlockDurationMs: number; // 0 = permanent

  constructor(config?: Partial<IPFilterConfig & {
    autoBlockThreshold?: number;
    autoBlockWindowMs?: number;
    autoBlockDurationMs?: number;
  }>) {
    this.config = {
      enabled: config?.enabled ?? false,
      mode: config?.mode ?? 'blocklist',
      allowlist: config?.allowlist ?? [],
      blocklist: config?.blocklist ?? [],
      allowPrivate: config?.allowPrivate ?? true,
    };
    this.autoBlockThreshold = config?.autoBlockThreshold ?? 100;
    this.autoBlockWindowMs = config?.autoBlockWindowMs ?? 5 * 60_000; // 5 min
    this.autoBlockDurationMs = config?.autoBlockDurationMs ?? 24 * 60 * 60_000; // 24h

    logger.info('IP filter initialized', { enabled: this.config.enabled, mode: this.config.mode });
  }

  isAllowed(ip: string): boolean {
    const normalized = this.normalize(ip);

    // Always check auto-blocked IPs (even if filter is "disabled")
    const threat = this.threats.get(normalized);
    if (threat?.blocked) {
      // Check expiry
      if (threat.expiresAt && threat.expiresAt > 0 && Date.now() > threat.expiresAt) {
        threat.blocked = false;
        this.config.blocklist = this.config.blocklist.filter(i => i !== normalized);
        logger.info('Auto-block expired', { ip: normalized });
      } else {
        return false;
      }
    }

    if (!this.config.enabled) return true;

    if (this.config.mode === 'allowlist') {
      if (this.config.allowPrivate && this.isPrivate(normalized)) return true;
      return this.config.allowlist.some(pattern => this.matches(normalized, pattern));
    }

    // blocklist mode
    if (this.config.blocklist.some(pattern => this.matches(normalized, pattern))) return false;
    return true;
  }

  /**
   * Record a threat event from an IP. Auto-blocks if threshold exceeded.
   * Returns true if the IP was auto-blocked as a result.
   */
  recordThreat(ip: string, reason: string): boolean {
    const normalized = this.normalize(ip);
    if (this.isPrivate(normalized)) return false; // Never auto-block private IPs

    const now = Date.now();
    let threat = this.threats.get(normalized);

    if (!threat) {
      threat = { ip: normalized, count: 0, firstSeen: now, lastSeen: now, blocked: false, autoBlocked: false, reason };
      this.threats.set(normalized, threat);
    }

    // Reset count if outside window
    if (now - threat.firstSeen > this.autoBlockWindowMs) {
      threat.count = 0;
      threat.firstSeen = now;
    }

    threat.count++;
    threat.lastSeen = now;
    threat.reason = reason;

    // Auto-block if threshold exceeded
    if (!threat.blocked && threat.count >= this.autoBlockThreshold) {
      threat.blocked = true;
      threat.autoBlocked = true;
      threat.blockedAt = now;
      threat.expiresAt = this.autoBlockDurationMs > 0 ? now + this.autoBlockDurationMs : 0;
      this.addToBlocklist(normalized);
      logger.warn(`IP auto-blocked after ${threat.count} threats`, { ip: normalized, reason });
      return true;
    }

    return false;
  }

  /**
   * Get all tracked threats, sorted by count descending.
   */
  getThreats(limit = 50): ThreatRecord[] {
    // Clean expired entries
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60_000; // Remove tracking entries older than 24h
    for (const [ip, t] of this.threats) {
      if (!t.blocked && now - t.lastSeen > staleThreshold) {
        this.threats.delete(ip);
      }
    }

    return Array.from(this.threats.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get blocked IPs with metadata.
   */
  getBlockedIPs(): ThreatRecord[] {
    return Array.from(this.threats.values()).filter(t => t.blocked);
  }

  /**
   * Manually block an IP with reason.
   */
  blockIP(ip: string, reason: string, durationMs = 0): void {
    const normalized = this.normalize(ip);
    const now = Date.now();
    let threat = this.threats.get(normalized);

    if (!threat) {
      threat = { ip: normalized, count: 0, firstSeen: now, lastSeen: now, blocked: false, autoBlocked: false, reason };
      this.threats.set(normalized, threat);
    }

    threat.blocked = true;
    threat.autoBlocked = false;
    threat.blockedAt = now;
    threat.expiresAt = durationMs > 0 ? now + durationMs : 0;
    threat.reason = reason;
    this.addToBlocklist(normalized);
    logger.info('IP manually blocked', { ip: normalized, reason, permanent: durationMs === 0 });
  }

  /**
   * Unblock an IP.
   */
  unblockIP(ip: string): boolean {
    const normalized = this.normalize(ip);
    const threat = this.threats.get(normalized);
    if (!threat?.blocked) return false;

    threat.blocked = false;
    this.config.blocklist = this.config.blocklist.filter(i => i !== normalized);
    logger.info('IP unblocked', { ip: normalized });
    return true;
  }

  /**
   * Get security stats summary.
   */
  getStats(): { totalThreats: number; blockedIPs: number; topOffenders: Array<{ ip: string; count: number; reason: string }> } {
    const threats = this.getThreats(10);
    return {
      totalThreats: Array.from(this.threats.values()).reduce((sum, t) => sum + t.count, 0),
      blockedIPs: this.getBlockedIPs().length,
      topOffenders: threats.slice(0, 10).map(t => ({ ip: t.ip, count: t.count, reason: t.reason })),
    };
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
