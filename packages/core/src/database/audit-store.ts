import type { Knex } from 'knex';
import type { AuditLogEntry } from '@forgeai/shared';
import type { AuditLogStore, AuditQueryFilters } from '@forgeai/security';

export class MySQLAuditStore implements AuditLogStore {
  constructor(private db: Knex) {}

  async insert(entry: AuditLogEntry): Promise<void> {
    await this.db('audit_log').insert({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      user_id: entry.userId,
      session_id: entry.sessionId,
      channel_type: entry.channelType,
      resource: entry.resource,
      details: JSON.stringify(entry.details),
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      success: entry.success,
      risk_level: entry.riskLevel,
      hash: entry.hash ?? null,
      previous_hash: entry.previousHash ?? null,
    });
  }

  async query(filters: AuditQueryFilters): Promise<AuditLogEntry[]> {
    let query = this.db('audit_log').select('*');

    if (filters.userId) query = query.where('user_id', filters.userId);
    if (filters.sessionId) query = query.where('session_id', filters.sessionId);
    if (filters.action) query = query.where('action', filters.action);
    if (filters.riskLevel) query = query.where('risk_level', filters.riskLevel);
    if (filters.success !== undefined) query = query.where('success', filters.success);
    if (filters.from) query = query.where('timestamp', '>=', filters.from);
    if (filters.to) query = query.where('timestamp', '<=', filters.to);

    query = query.orderBy('timestamp', 'desc');

    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.offset(filters.offset);

    const rows = await query;

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      timestamp: new Date(row['timestamp'] as string),
      action: row['action'] as AuditLogEntry['action'],
      userId: row['user_id'] as string | undefined,
      sessionId: row['session_id'] as string | undefined,
      channelType: row['channel_type'] as string | undefined,
      resource: row['resource'] as string | undefined,
      details: typeof row['details'] === 'string' ? JSON.parse(row['details']) : (row['details'] as Record<string, unknown>),
      ipAddress: row['ip_address'] as string | undefined,
      userAgent: row['user_agent'] as string | undefined,
      success: Boolean(row['success']),
      riskLevel: row['risk_level'] as AuditLogEntry['riskLevel'],
      hash: row['hash'] as string | undefined,
      previousHash: row['previous_hash'] as string | undefined,
    }));
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const deleted = await this.db('audit_log').where('timestamp', '<', date).delete();
    return deleted;
  }

  async count(filters: AuditQueryFilters): Promise<number> {
    let query = this.db('audit_log').count('* as total');

    if (filters.userId) query = query.where('user_id', filters.userId);
    if (filters.sessionId) query = query.where('session_id', filters.sessionId);
    if (filters.action) query = query.where('action', filters.action);
    if (filters.riskLevel) query = query.where('risk_level', filters.riskLevel);
    if (filters.success !== undefined) query = query.where('success', filters.success);
    if (filters.from) query = query.where('timestamp', '>=', filters.from);
    if (filters.to) query = query.where('timestamp', '<=', filters.to);

    const result = await query.first();
    return Number((result as Record<string, unknown>)?.['total'] ?? 0);
  }
}
