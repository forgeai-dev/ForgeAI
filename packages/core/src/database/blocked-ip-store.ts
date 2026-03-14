import type { Knex } from 'knex';
import type { ThreatRecord } from '@forgeai/security';

export class BlockedIPStore {
  constructor(private db: Knex) {}

  async loadBlocked(): Promise<ThreatRecord[]> {
    const rows = await this.db('blocked_ips').select('*');
    return rows.map((row: Record<string, unknown>) => ({
      ip: row['ip'] as string,
      reason: row['reason'] as string,
      autoBlocked: Boolean(row['auto_blocked']),
      count: Number(row['threat_count']),
      blocked: true,
      blockedAt: Number(row['blocked_at']),
      expiresAt: Number(row['expires_at']),
      firstSeen: Number(row['first_seen']),
      lastSeen: Number(row['last_seen']),
    }));
  }

  async saveBlocked(record: ThreatRecord): Promise<void> {
    await this.db('blocked_ips')
      .insert({
        ip: record.ip,
        reason: record.reason,
        auto_blocked: record.autoBlocked,
        threat_count: record.count,
        blocked_at: record.blockedAt ?? Date.now(),
        expires_at: record.expiresAt ?? 0,
        first_seen: record.firstSeen,
        last_seen: record.lastSeen,
      })
      .onConflict('ip')
      .merge();
  }

  async removeBlocked(ip: string): Promise<void> {
    await this.db('blocked_ips').where('ip', ip).delete();
  }

  async removeExpired(): Promise<number> {
    const now = Date.now();
    return this.db('blocked_ips')
      .where('expires_at', '>', 0)
      .andWhere('expires_at', '<', now)
      .delete();
  }
}
