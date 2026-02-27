import type { Knex } from 'knex';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:ActivityStore');

export interface ActivityEntry {
  id?: number;
  timestamp: Date;
  type: 'tool_exec' | 'host_cmd' | 'blocked' | 'error';
  toolName: string;
  target: 'server' | 'host' | 'companion';
  command?: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  success: boolean;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
}

export interface ActivityQueryFilters {
  type?: string;
  target?: string;
  riskLevel?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface ActivityStats {
  totalToday: number;
  hostToday: number;
  blockedToday: number;
  errorToday: number;
}

/**
 * Generates a human-readable summary for a tool execution.
 */
export function generateActivitySummary(
  toolName: string,
  params: Record<string, unknown>,
  success: boolean,
  blocked?: boolean
): { summary: string; type: ActivityEntry['type']; riskLevel: ActivityEntry['riskLevel']; target: ActivityEntry['target']; command?: string } {
  const target = String(params['target'] || 'server').toLowerCase() as ActivityEntry['target'];

  if (blocked) {
    const cmd = String(params['command'] || '').substring(0, 200);
    return {
      summary: `🛡️ Blocked dangerous command: ${cmd || toolName}`,
      type: 'blocked',
      riskLevel: 'critical',
      target,
      command: cmd,
    };
  }

  switch (toolName) {
    case 'shell_exec': {
      const cmd = String(params['command'] || '').substring(0, 500);
      const cwd = params['cwd'] ? ` in ${params['cwd']}` : '';
      const isHost = target === 'host';
      const isCompanion = target === 'companion';

      // Detect risk level based on command content
      let riskLevel: ActivityEntry['riskLevel'] = 'low';
      const lowerCmd = cmd.toLowerCase();
      if (isHost) riskLevel = 'medium';
      if (lowerCmd.includes('apt install') || lowerCmd.includes('pip install') || lowerCmd.includes('npm install -g')) riskLevel = 'medium';
      if (lowerCmd.includes('systemctl') || lowerCmd.includes('service ')) riskLevel = 'high';
      if (lowerCmd.includes('rm -rf') || lowerCmd.includes('chmod') || lowerCmd.includes('chown')) riskLevel = 'high';
      if (lowerCmd.includes('iptables') || lowerCmd.includes('ufw')) riskLevel = 'high';

      const prefix = isHost ? '🖥️ [HOST]' : isCompanion ? '💻 [COMPANION]' : '🐳 [CONTAINER]';
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `${prefix} ${statusIcon} ${cmd.substring(0, 120)}${cwd}`,
        type: isHost ? 'host_cmd' : 'tool_exec',
        riskLevel,
        target,
        command: cmd,
      };
    }

    case 'file_manager': {
      const action = String(params['action'] || 'read');
      const path = String(params['path'] || '');
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `📁 ${statusIcon} file_manager.${action}: ${path.substring(0, 200)}`,
        type: 'tool_exec',
        riskLevel: action === 'delete' ? 'medium' : 'low',
        target,
      };
    }

    case 'browser': {
      const action = String(params['action'] || 'navigate');
      const url = String(params['url'] || '');
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `🌐 ${statusIcon} browser.${action}${url ? `: ${url.substring(0, 150)}` : ''}`,
        type: 'tool_exec',
        riskLevel: 'low',
        target,
      };
    }

    case 'desktop': {
      const action = String(params['action'] || 'screenshot');
      const desktopTarget = params['target'] ? ` → ${String(params['target']).substring(0, 80)}` : '';
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `🖱️ ${statusIcon} desktop.${action}${desktopTarget}`,
        type: 'tool_exec',
        riskLevel: 'low',
        target: 'companion',
      };
    }

    case 'web_search': {
      const query = String(params['query'] || '');
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `🔍 ${statusIcon} web_search: ${query.substring(0, 150)}`,
        type: 'tool_exec',
        riskLevel: 'low',
        target,
      };
    }

    default: {
      const statusIcon = success ? '✅' : '❌';
      return {
        summary: `⚙️ ${statusIcon} ${toolName}`,
        type: 'tool_exec',
        riskLevel: 'low',
        target,
      };
    }
  }
}

export class ActivityStore {
  constructor(private db: Knex) {}

  async insert(entry: Omit<ActivityEntry, 'id'>): Promise<void> {
    try {
      await this.db('activity_log').insert({
        timestamp: entry.timestamp,
        type: entry.type,
        tool_name: entry.toolName,
        target: entry.target,
        command: entry.command?.substring(0, 1024) || null,
        summary: entry.summary.substring(0, 512),
        risk_level: entry.riskLevel,
        success: entry.success,
        duration_ms: entry.durationMs || null,
        session_id: entry.sessionId || null,
        user_id: entry.userId || null,
      });
    } catch (err) {
      logger.error('Failed to insert activity log', err);
    }
  }

  async query(filters: ActivityQueryFilters): Promise<ActivityEntry[]> {
    let query = this.db('activity_log').select('*');

    if (filters.type) query = query.where('type', filters.type);
    if (filters.target) query = query.where('target', filters.target);
    if (filters.riskLevel) query = query.where('risk_level', filters.riskLevel);
    if (filters.success !== undefined) query = query.where('success', filters.success);
    if (filters.from) query = query.where('timestamp', '>=', filters.from);
    if (filters.to) query = query.where('timestamp', '<=', filters.to);

    query = query.orderBy('timestamp', 'desc');
    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.offset(filters.offset);

    const rows = await query;

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as number,
      timestamp: new Date(row['timestamp'] as string),
      type: row['type'] as ActivityEntry['type'],
      toolName: row['tool_name'] as string,
      target: row['target'] as ActivityEntry['target'],
      command: row['command'] as string | undefined,
      summary: row['summary'] as string,
      riskLevel: row['risk_level'] as ActivityEntry['riskLevel'],
      success: Boolean(row['success']),
      durationMs: row['duration_ms'] as number | undefined,
      sessionId: row['session_id'] as string | undefined,
      userId: row['user_id'] as string | undefined,
    }));
  }

  async getStats(): Promise<ActivityStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalRow] = await this.db('activity_log').count('* as c').where('timestamp', '>=', today);
    const [hostRow] = await this.db('activity_log').count('* as c').where('timestamp', '>=', today).where('target', 'host');
    const [blockedRow] = await this.db('activity_log').count('* as c').where('timestamp', '>=', today).where('type', 'blocked');
    const [errorRow] = await this.db('activity_log').count('* as c').where('timestamp', '>=', today).where('success', false);

    return {
      totalToday: Number((totalRow as Record<string, unknown>)['c'] || 0),
      hostToday: Number((hostRow as Record<string, unknown>)['c'] || 0),
      blockedToday: Number((blockedRow as Record<string, unknown>)['c'] || 0),
      errorToday: Number((errorRow as Record<string, unknown>)['c'] || 0),
    };
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return this.db('activity_log').where('timestamp', '<', cutoff).delete();
  }
}
