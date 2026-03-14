import type { AuditLogEntry, AuditAction, RiskLevel, SecurityAlert } from '@forgeai/shared';
import { createLogger, generateId } from '@forgeai/shared';
import { createHash } from 'node:crypto';

const logger = createLogger('Security:AuditLogger');

export interface AuditLogStore {
  insert(entry: AuditLogEntry): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditLogEntry[]>;
  count(filters: AuditQueryFilters): Promise<number>;
  deleteOlderThan?(date: Date): Promise<number>;
  updateHash?(id: string, hash: string, previousHash: string): Promise<void>;
}

export interface AuditQueryFilters {
  userId?: string;
  sessionId?: string;
  action?: AuditAction;
  riskLevel?: RiskLevel;
  success?: boolean;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export type SecurityAlertHandler = (alert: SecurityAlert) => void | Promise<void>;

export class AuditLogger {
  private store: AuditLogStore | null = null;
  private buffer: AuditLogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private maxBufferSize: number;
  private lastHash: string = '0'.repeat(64);
  private alertHandlers: SecurityAlertHandler[] = [];

  constructor(maxBufferSize: number = 100) {
    this.maxBufferSize = maxBufferSize;
  }

  setStore(store: AuditLogStore): void {
    this.store = store;
    // Start flushing buffer to store every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5_000);
    logger.info('Audit log store connected');
  }

  log(params: {
    action: AuditAction;
    userId?: string;
    sessionId?: string;
    channelType?: string;
    resource?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    riskLevel?: RiskLevel;
  }): void {
    const entry: AuditLogEntry = {
      id: generateId('audit'),
      timestamp: new Date(),
      action: params.action,
      userId: params.userId,
      sessionId: params.sessionId,
      channelType: params.channelType,
      resource: params.resource,
      details: params.details ?? {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      success: params.success ?? true,
      riskLevel: params.riskLevel ?? this.inferRiskLevel(params.action, params.success ?? true),
      previousHash: this.lastHash,
    };

    // Compute hash chain: SHA-256(previousHash + id + timestamp + action + riskLevel)
    entry.hash = this.computeHash(entry);
    this.lastHash = entry.hash;

    this.buffer.push(entry);

    // Log high-risk events immediately to console
    if (entry.riskLevel === 'high' || entry.riskLevel === 'critical') {
      logger.warn(`[AUDIT] ${entry.action}`, {
        userId: entry.userId,
        riskLevel: entry.riskLevel,
        success: entry.success,
      });

      // Fire security alerts for high/critical events
      this.fireAlert(entry);
    }

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  private inferRiskLevel(action: AuditAction, success: boolean): RiskLevel {
    if (!success) {
      if (action.startsWith('auth.')) return 'high';
      return 'medium';
    }

    const criticalActions: AuditAction[] = [
      'vault.update', 'user.delete', 'config.update', 'sandbox.violation',
    ];
    const highActions: AuditAction[] = [
      'tool.execute', 'tool.blocked', 'prompt_injection.detected',
      'anomaly.detected', 'rate_limit.exceeded', 'auth.login_failed', 'auth.2fa_failed',
    ];
    const mediumActions: AuditAction[] = [
      'session.create', 'session.suspend', 'channel.connect',
      'channel.disconnect', 'user.create', 'user.update', 'vault.access',
    ];

    if (criticalActions.includes(action)) return 'critical';
    if (highActions.includes(action)) return 'high';
    if (mediumActions.includes(action)) return 'medium';
    return 'low';
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.store) return;

    const toFlush = [...this.buffer];
    this.buffer = [];

    try {
      for (const entry of toFlush) {
        await this.store.insert(entry);
      }
      logger.debug('Audit log flushed', { count: toFlush.length });
    } catch (error) {
      // Put entries back in buffer on failure
      this.buffer.unshift(...toFlush);
      logger.error('Failed to flush audit log', error);
    }
  }

  async query(filters: AuditQueryFilters): Promise<AuditLogEntry[]> {
    if (!this.store) {
      logger.warn('No audit store configured, returning buffer entries');
      return this.filterBuffer(filters);
    }
    return this.store.query(filters);
  }

  private filterBuffer(filters: AuditQueryFilters): AuditLogEntry[] {
    let results = [...this.buffer];

    if (filters.userId) results = results.filter(e => e.userId === filters.userId);
    if (filters.sessionId) results = results.filter(e => e.sessionId === filters.sessionId);
    if (filters.action) results = results.filter(e => e.action === filters.action);
    if (filters.riskLevel) results = results.filter(e => e.riskLevel === filters.riskLevel);
    if (filters.success !== undefined) results = results.filter(e => e.success === filters.success);
    if (filters.from) results = results.filter(e => e.timestamp >= filters.from!);
    if (filters.to) results = results.filter(e => e.timestamp <= filters.to!);

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  private computeHash(entry: AuditLogEntry): string {
    // Truncate milliseconds for consistency: MySQL TIMESTAMP drops ms precision,
    // so we normalize to .000Z to ensure hash matches after DB round-trip.
    const ts = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp as unknown as string);
    const normalizedTs = new Date(Math.floor(ts.getTime() / 1000) * 1000).toISOString();
    const payload = `${entry.previousHash}|${entry.id}|${normalizedTs}|${entry.action}|${entry.riskLevel}|${entry.success}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  // ─── Security Alerts ────────────────────────────────

  onAlert(handler: SecurityAlertHandler): void {
    this.alertHandlers.push(handler);
  }

  private fireAlert(entry: AuditLogEntry): void {
    if (this.alertHandlers.length === 0) return;

    const alert: SecurityAlert = {
      id: generateId('alert'),
      timestamp: entry.timestamp,
      severity: entry.riskLevel === 'critical' ? 'critical' : 'warning',
      title: this.getAlertTitle(entry.action),
      message: this.formatAlertMessage(entry),
      auditEntryId: entry.id,
      notified: false,
    };

    for (const handler of this.alertHandlers) {
      try {
        const result = handler(alert);
        if (result instanceof Promise) result.catch(err => logger.error('Alert handler failed', err));
      } catch (err) {
        logger.error('Alert handler failed (sync)', err);
      }
    }
  }

  private getAlertTitle(action: AuditAction): string {
    const titles: Partial<Record<AuditAction, string>> = {
      'prompt_injection.detected': '🛡️ Prompt Injection Detected',
      'rate_limit.exceeded': '⚡ Rate Limit Exceeded',
      'sandbox.violation': '🔒 Sandbox Violation',
      'auth.login_failed': '🔑 Authentication Failed',
      'auth.2fa_failed': '🔑 2FA Verification Failed',
      'tool.blocked': '🚫 Tool Execution Blocked',
      'anomaly.detected': '⚠️ Anomaly Detected',
      'vault.update': '🔐 Vault Modified',
      'user.delete': '👤 User Deleted',
      'config.update': '⚙️ Configuration Changed',
      'security.rbac_denied': '🚫 Access Denied (RBAC)',
    };
    return titles[action] ?? `⚠️ Security Event: ${action}`;
  }

  private formatAlertMessage(entry: AuditLogEntry): string {
    const parts = [
      `Action: ${entry.action}`,
      `Risk: ${entry.riskLevel.toUpperCase()}`,
      `Status: ${entry.success ? 'OK' : 'BLOCKED'}`,
    ];
    if (entry.userId) parts.push(`User: ${entry.userId}`);
    if (entry.ipAddress) parts.push(`IP: ${entry.ipAddress}`);
    if (entry.channelType) parts.push(`Channel: ${entry.channelType}`);
    if (entry.details && Object.keys(entry.details).length > 0) {
      parts.push(`Details: ${JSON.stringify(entry.details)}`);
    }
    return parts.join('\n');
  }

  // ─── Integrity Verification ─────────────────────────

  async verifyIntegrity(limit: number = 1000): Promise<{
    valid: boolean;
    totalChecked: number;
    brokenAtId?: string;
    brokenAtIndex?: number;
    message: string;
  }> {
    if (!this.store) {
      return { valid: false, totalChecked: 0, message: 'No audit store configured' };
    }

    // Query entries in chronological order
    const entries = await this.store.query({
      limit,
      offset: 0,
    });

    // Entries come DESC from store, reverse to ASC
    entries.reverse();

    if (entries.length === 0) {
      return { valid: true, totalChecked: 0, message: 'No entries to verify' };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.hash || !entry.previousHash) continue; // Skip legacy entries without hash

      const expectedHash = this.computeHash(entry);
      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          totalChecked: i + 1,
          brokenAtId: entry.id,
          brokenAtIndex: i,
          message: `Integrity broken at entry ${entry.id} (index ${i}): hash mismatch — possible tampering`,
        };
      }

      // Verify chain link (entry[i].previousHash should match entry[i-1].hash)
      if (i > 0 && entries[i - 1].hash) {
        if (entry.previousHash !== entries[i - 1].hash) {
          return {
            valid: false,
            totalChecked: i + 1,
            brokenAtId: entry.id,
            brokenAtIndex: i,
            message: `Chain broken at entry ${entry.id} (index ${i}): previousHash does not match prior entry — possible deletion or insertion`,
          };
        }
      }
    }

    return {
      valid: true,
      totalChecked: entries.length,
      message: `All ${entries.length} entries verified — integrity intact`,
    };
  }

  // ─── Hash Chain Repair ─────────────────────────────

  /**
   * Recompute the entire hash chain with the current (ms-truncated) hash algorithm.
   * This repairs chains broken by the old ms-sensitive hash computation.
   */
  async repairHashChain(limit: number = 10000): Promise<{ repaired: number; total: number }> {
    if (!this.store || !this.store.updateHash) {
      return { repaired: 0, total: 0 };
    }

    // Query ALL entries in chronological order (oldest first)
    const entries = await this.store.query({ limit, offset: 0 });
    entries.reverse(); // DESC → ASC

    if (entries.length === 0) return { repaired: 0, total: 0 };

    let repaired = 0;
    let previousHash = '0'.repeat(64);

    for (const entry of entries) {
      entry.previousHash = previousHash;
      const correctHash = this.computeHash(entry);

      if (entry.hash !== correctHash) {
        await this.store.updateHash(entry.id, correctHash, previousHash);
        repaired++;
      }

      previousHash = correctHash;
    }

    // Update lastHash so new entries continue the chain
    this.lastHash = previousHash;

    logger.info(`Hash chain repair complete: ${repaired}/${entries.length} entries recomputed`);
    return { repaired, total: entries.length };
  }

  // ─── Export ─────────────────────────────────────────

  async exportEntries(filters: AuditQueryFilters, format: 'json' | 'csv' = 'json'): Promise<string> {
    const entries = await this.query({ ...filters, limit: filters.limit ?? 10000 });

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'action', 'userId', 'sessionId', 'channelType', 'resource', 'success', 'riskLevel', 'ipAddress', 'hash', 'details'];
      const rows = entries.map(e => [
        e.id,
        e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
        e.action,
        e.userId ?? '',
        e.sessionId ?? '',
        e.channelType ?? '',
        e.resource ?? '',
        String(e.success),
        e.riskLevel,
        e.ipAddress ?? '',
        e.hash ?? '',
        JSON.stringify(e.details).replace(/"/g, '""'),
      ]);
      return [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    }

    return JSON.stringify(entries, null, 2);
  }

  // ─── Stats ──────────────────────────────────────────

  async getSecurityStats(): Promise<{
    total: number;
    byRiskLevel: Record<string, number>;
    byAction: Record<string, number>;
    recentHighRisk: AuditLogEntry[];
    alertsSent: number;
  }> {
    const total = this.store ? await this.store.count({}) : this.buffer.length;

    const recentAll = await this.query({ limit: 500 });

    const byRiskLevel: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byAction: Record<string, number> = {};
    let alertsSent = 0;

    for (const entry of recentAll) {
      byRiskLevel[entry.riskLevel] = (byRiskLevel[entry.riskLevel] ?? 0) + 1;
      byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
      if (entry.action === 'security.alert_sent') alertsSent++;
    }

    const recentHighRisk = recentAll
      .filter(e => e.riskLevel === 'high' || e.riskLevel === 'critical')
      .slice(0, 20);

    return { total, byRiskLevel, byAction, recentHighRisk, alertsSent };
  }

  // ─── Log Rotation ─────────────────────────────────

  async rotate(retentionDays: number = 90): Promise<{ deleted: number; remaining: number }> {
    if (!this.store) {
      return { deleted: 0, remaining: this.buffer.length };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    let deleted = 0;
    if (this.store.deleteOlderThan) {
      deleted = await this.store.deleteOlderThan(cutoff);
    } else {
      logger.warn('Audit store does not support deleteOlderThan — rotation skipped');
    }

    const remaining = await this.store.count({});

    if (deleted > 0) {
      logger.info(`Audit log rotation: deleted ${deleted} entries older than ${retentionDays} days, ${remaining} remaining`);

      this.log({
        action: 'config.update',
        details: { operation: 'audit_rotation', deleted, remaining, retentionDays, cutoff: cutoff.toISOString() },
        riskLevel: 'medium',
      });
    }

    return { deleted, remaining };
  }

  setLastHash(hash: string): void {
    this.lastHash = hash;
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    this.buffer = [];
  }
}

export function createAuditLogger(maxBufferSize?: number): AuditLogger {
  return new AuditLogger(maxBufferSize);
}
