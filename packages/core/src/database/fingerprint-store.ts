import type { Knex } from 'knex';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:FingerprintStore');

export interface StoredFingerprint {
  id: string;
  url: string;
  selector: string;
  fingerprint_json: string;
  last_matched: Date;
  match_count: number;
  created_at: Date;
  updated_at: Date;
}

export class FingerprintStore {
  constructor(private db: Knex) {}

  async save(fingerprint: {
    id: string;
    url: string;
    selector: string;
    data: Record<string, unknown>;
    matchCount?: number;
  }): Promise<void> {
    try {
      const now = new Date();
      const existing = await this.db('element_fingerprints')
        .where('id', fingerprint.id)
        .first();

      if (existing) {
        await this.db('element_fingerprints')
          .where('id', fingerprint.id)
          .update({
            fingerprint_json: JSON.stringify(fingerprint.data),
            match_count: (existing as StoredFingerprint).match_count + 1,
            last_matched: now,
            updated_at: now,
          });
      } else {
        await this.db('element_fingerprints').insert({
          id: fingerprint.id,
          url: fingerprint.url,
          selector: fingerprint.selector,
          fingerprint_json: JSON.stringify(fingerprint.data),
          match_count: fingerprint.matchCount || 1,
          last_matched: now,
          created_at: now,
          updated_at: now,
        });
      }
    } catch (err) {
      logger.error('Failed to save fingerprint', err);
    }
  }

  async get(id: string): Promise<StoredFingerprint | null> {
    try {
      const row = await this.db('element_fingerprints')
        .where('id', id)
        .first();
      return (row as StoredFingerprint) || null;
    } catch (err) {
      logger.error('Failed to get fingerprint', err);
      return null;
    }
  }

  async getByUrlAndSelector(url: string, selector: string): Promise<StoredFingerprint | null> {
    try {
      const row = await this.db('element_fingerprints')
        .where('url', url)
        .andWhere('selector', selector)
        .first();
      return (row as StoredFingerprint) || null;
    } catch (err) {
      logger.error('Failed to get fingerprint by URL+selector', err);
      return null;
    }
  }

  async getByUrl(url: string): Promise<StoredFingerprint[]> {
    try {
      const rows = await this.db('element_fingerprints')
        .where('url', url)
        .orderBy('match_count', 'desc');
      return rows as StoredFingerprint[];
    } catch (err) {
      logger.error('Failed to get fingerprints by URL', err);
      return [];
    }
  }

  async updateMatchCount(id: string): Promise<void> {
    try {
      await this.db('element_fingerprints')
        .where('id', id)
        .update({
          match_count: this.db.raw('match_count + 1'),
          last_matched: new Date(),
        });
    } catch (err) {
      logger.error('Failed to update match count', err);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db('element_fingerprints').where('id', id).delete();
    } catch (err) {
      logger.error('Failed to delete fingerprint', err);
    }
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    try {
      return await this.db('element_fingerprints')
        .where('last_matched', '<', cutoff)
        .delete();
    } catch (err) {
      logger.error('Failed to cleanup fingerprints', err);
      return 0;
    }
  }

  async count(): Promise<number> {
    try {
      const [row] = await this.db('element_fingerprints').count('* as c');
      return Number((row as Record<string, unknown>)['c'] || 0);
    } catch (err) {
      logger.error('Failed to count fingerprints', err);
      return 0;
    }
  }
}
