import type { Knex } from 'knex';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:MemoryStore');

export interface MemoryEntryRow {
  id: string;
  content: string;
  embedding_json: string | null;
  metadata: string | null;
  session_id: string | null;
  agent_id: string | null;
  memory_type: string;
  importance: number;
  embedding_provider: string;
  access_count: number;
  last_accessed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MemoryEntityRow {
  id: string;
  name: string;
  entity_type: string;
  memory_id: string;
  attributes: string | null;
  created_at: Date;
}

export class MemoryStore {
  constructor(private db: Knex) {}

  // ─── Memory Entries CRUD ─────────────────────────────

  async insert(entry: {
    id: string;
    content: string;
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    sessionId?: string;
    agentId?: string;
    memoryType: string;
    importance: number;
    embeddingProvider: string;
  }): Promise<void> {
    await this.db('memory_entries').insert({
      id: entry.id,
      content: entry.content,
      embedding_json: entry.embedding ? JSON.stringify(entry.embedding) : null,
      metadata: JSON.stringify(entry.metadata),
      session_id: entry.sessionId ?? null,
      agent_id: entry.agentId ?? null,
      memory_type: entry.memoryType,
      importance: entry.importance,
      embedding_provider: entry.embeddingProvider,
      access_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  async getById(id: string): Promise<MemoryEntryRow | null> {
    const row = await this.db('memory_entries').where('id', id).first();
    return row ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db('memory_entries').where('id', id).del();
    return count > 0;
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db('memory_entries').whereIn('id', ids).del();
  }

  async loadAll(): Promise<MemoryEntryRow[]> {
    return this.db('memory_entries').select('*').orderBy('created_at', 'asc');
  }

  async loadRecent(limit: number): Promise<MemoryEntryRow[]> {
    return this.db('memory_entries')
      .select('*')
      .orderBy('updated_at', 'desc')
      .limit(limit);
  }

  async getBySession(sessionId: string, limit = 50): Promise<MemoryEntryRow[]> {
    return this.db('memory_entries')
      .where('session_id', sessionId)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  async getByType(memoryType: string, limit = 100): Promise<MemoryEntryRow[]> {
    return this.db('memory_entries')
      .where('memory_type', memoryType)
      .orderBy('importance', 'desc')
      .limit(limit);
  }

  async updateAccessCount(id: string): Promise<void> {
    await this.db('memory_entries')
      .where('id', id)
      .update({
        access_count: this.db.raw('access_count + 1'),
        last_accessed_at: new Date(),
      });
  }

  async updateImportance(id: string, importance: number): Promise<void> {
    await this.db('memory_entries')
      .where('id', id)
      .update({ importance, updated_at: new Date() });
  }

  async count(): Promise<number> {
    const result = await this.db('memory_entries').count('id as cnt').first();
    return Number((result as Record<string, unknown>)?.cnt ?? 0);
  }

  async getStats(): Promise<{
    total: number;
    sessions: number;
    avgImportance: number;
    byType: Record<string, number>;
    oldestMs: number;
    embeddingProviders: Record<string, number>;
  }> {
    const total = await this.count();

    const sessionResult = await this.db('memory_entries')
      .countDistinct('session_id as cnt')
      .whereNotNull('session_id')
      .first();
    const sessions = Number((sessionResult as Record<string, unknown>)?.cnt ?? 0);

    const avgResult = await this.db('memory_entries')
      .avg('importance as avg')
      .first();
    const avgImportance = Math.round(Number((avgResult as Record<string, unknown>)?.avg ?? 0) * 100) / 100;

    const typeRows = await this.db('memory_entries')
      .select('memory_type')
      .count('id as cnt')
      .groupBy('memory_type');
    const byType: Record<string, number> = {};
    for (const row of typeRows as Array<{ memory_type: string; cnt: number }>) {
      byType[row.memory_type] = Number(row.cnt);
    }

    const oldestRow = await this.db('memory_entries')
      .min('created_at as oldest')
      .first();
    const oldest = (oldestRow as Record<string, unknown>)?.oldest;
    const oldestMs = oldest ? Date.now() - new Date(oldest as string).getTime() : 0;

    const providerRows = await this.db('memory_entries')
      .select('embedding_provider')
      .count('id as cnt')
      .groupBy('embedding_provider');
    const embeddingProviders: Record<string, number> = {};
    for (const row of providerRows as Array<{ embedding_provider: string; cnt: number }>) {
      embeddingProviders[row.embedding_provider] = Number(row.cnt);
    }

    return { total, sessions, avgImportance, byType, oldestMs, embeddingProviders };
  }

  // ─── Memory Entities CRUD ────────────────────────────

  async insertEntity(entity: {
    id: string;
    name: string;
    entityType: string;
    memoryId: string;
    attributes?: Record<string, unknown>;
  }): Promise<void> {
    await this.db('memory_entities').insert({
      id: entity.id,
      name: entity.name,
      entity_type: entity.entityType,
      memory_id: entity.memoryId,
      attributes: entity.attributes ? JSON.stringify(entity.attributes) : null,
      created_at: new Date(),
    });
  }

  async getEntitiesByMemory(memoryId: string): Promise<MemoryEntityRow[]> {
    return this.db('memory_entities').where('memory_id', memoryId);
  }

  async searchEntities(name: string, limit = 20): Promise<MemoryEntityRow[]> {
    return this.db('memory_entities')
      .where('name', 'like', `%${name}%`)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  async getEntitiesByType(entityType: string, limit = 50): Promise<MemoryEntityRow[]> {
    return this.db('memory_entities')
      .where('entity_type', entityType)
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  async entityCount(): Promise<number> {
    const result = await this.db('memory_entities').count('id as cnt').first();
    return Number((result as Record<string, unknown>)?.cnt ?? 0);
  }

  // ─── Cleanup ─────────────────────────────────────────

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.db('memory_entries')
      .where('created_at', '<', cutoff)
      .where('importance', '<', 0.7) // keep high-importance entries
      .del();
  }

  async vacuum(): Promise<{ entriesBefore: number; entriesAfter: number; removed: number }> {
    const before = await this.count();
    // Remove low-importance entries older than 90 days
    await this.deleteOlderThan(90);
    const after = await this.count();
    const removed = before - after;
    if (removed > 0) {
      logger.info('Memory vacuum completed', { removed, remaining: after });
    }
    return { entriesBefore: before, entriesAfter: after, removed };
  }
}

export function createMemoryStore(db: Knex): MemoryStore {
  return new MemoryStore(db);
}
