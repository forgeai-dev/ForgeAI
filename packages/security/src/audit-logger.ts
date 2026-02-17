import type { AuditLogEntry, AuditAction, RiskLevel } from '@forgeai/shared';
import { createLogger, generateId } from '@forgeai/shared';

const logger = createLogger('Security:AuditLogger');

export interface AuditLogStore {
  insert(entry: AuditLogEntry): Promise<void>;
  query(filters: AuditQueryFilters): Promise<AuditLogEntry[]>;
  count(filters: AuditQueryFilters): Promise<number>;
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

export class AuditLogger {
  private store: AuditLogStore | null = null;
  private buffer: AuditLogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private maxBufferSize: number;

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
    };

    this.buffer.push(entry);

    // Log high-risk events immediately to console
    if (entry.riskLevel === 'high' || entry.riskLevel === 'critical') {
      logger.warn(`[AUDIT] ${entry.action}`, {
        userId: entry.userId,
        riskLevel: entry.riskLevel,
        success: entry.success,
      });
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
