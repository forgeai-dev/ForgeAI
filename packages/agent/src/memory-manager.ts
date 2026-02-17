import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:Memory');

export interface MemoryEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  timestamp: number;
  sessionId?: string;
  importance: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemoryConfig {
  maxEntries: number;
  similarityThreshold: number;
  autoConsolidate: boolean;
  consolidateAfter: number;
}

export class MemoryManager {
  private entries: Map<string, MemoryEntry> = new Map();
  private config: MemoryConfig;
  private vocabIndex: Map<string, number> = new Map();
  private vocabCounter = 0;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 10000,
      similarityThreshold: config?.similarityThreshold ?? 0.3,
      autoConsolidate: config?.autoConsolidate ?? true,
      consolidateAfter: config?.consolidateAfter ?? 1000,
    };
    logger.info('Memory manager initialized', { maxEntries: this.config.maxEntries });
  }

  store(id: string, content: string, metadata: Record<string, unknown> = {}, sessionId?: string): MemoryEntry {
    const embedding = this.embed(content);
    const importance = this.calculateImportance(content, metadata);

    const entry: MemoryEntry = {
      id,
      content,
      metadata,
      embedding,
      timestamp: Date.now(),
      sessionId,
      importance,
    };

    this.entries.set(id, entry);

    // Evict low-importance entries if over limit
    if (this.entries.size > this.config.maxEntries) {
      this.evictLowest();
    }

    // Auto-consolidate
    if (this.config.autoConsolidate && this.entries.size > 0 && this.entries.size % this.config.consolidateAfter === 0) {
      this.consolidate();
    }

    logger.debug('Memory stored', { id, importance: importance.toFixed(2) });
    return entry;
  }

  search(query: string, limit = 10, sessionId?: string): MemorySearchResult[] {
    const queryEmbedding = this.embed(query);
    const results: MemorySearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (sessionId && entry.sessionId && entry.sessionId !== sessionId) continue;
      const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (score >= this.config.similarityThreshold) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => {
      // Weighted by score (70%) + importance (20%) + recency (10%)
      const now = Date.now();
      const recencyA = Math.max(0, 1 - (now - a.entry.timestamp) / (7 * 24 * 60 * 60 * 1000));
      const recencyB = Math.max(0, 1 - (now - b.entry.timestamp) / (7 * 24 * 60 * 60 * 1000));
      const weightedA = a.score * 0.7 + a.entry.importance * 0.2 + recencyA * 0.1;
      const weightedB = b.score * 0.7 + b.entry.importance * 0.2 + recencyB * 0.1;
      return weightedB - weightedA;
    });

    return results.slice(0, limit);
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  getBySession(sessionId: string, limit = 50): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) results.push(entry);
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  consolidate(): { merged: number; removed: number } {
    let merged = 0;
    let removed = 0;
    const entries = Array.from(this.entries.values());

    // Find near-duplicate entries and merge them
    const toRemove = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      if (toRemove.has(entries[i].id)) continue;
      for (let j = i + 1; j < entries.length; j++) {
        if (toRemove.has(entries[j].id)) continue;
        const similarity = this.cosineSimilarity(entries[i].embedding, entries[j].embedding);
        if (similarity > 0.9) {
          // Keep the more important / recent one
          if (entries[i].importance >= entries[j].importance) {
            toRemove.add(entries[j].id);
          } else {
            toRemove.add(entries[i].id);
            break;
          }
          merged++;
        }
      }
    }

    for (const id of toRemove) {
      this.entries.delete(id);
      removed++;
    }

    if (merged > 0) logger.info('Memory consolidated', { merged, removed });
    return { merged, removed };
  }

  getStats(): { total: number; sessions: number; avgImportance: number; oldestMs: number } {
    const entries = Array.from(this.entries.values());
    const sessions = new Set(entries.map(e => e.sessionId).filter(Boolean));
    const avgImportance = entries.length > 0
      ? entries.reduce((sum, e) => sum + e.importance, 0) / entries.length
      : 0;
    const oldest = entries.length > 0
      ? Math.min(...entries.map(e => e.timestamp))
      : Date.now();

    return {
      total: entries.length,
      sessions: sessions.size,
      avgImportance: Math.round(avgImportance * 100) / 100,
      oldestMs: Date.now() - oldest,
    };
  }

  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  clear(): void {
    this.entries.clear();
    logger.info('Memory cleared');
  }

  // Simple TF-IDF-like embedding using term frequency vectors
  private embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const tf = new Map<number, number>();

    for (const token of tokens) {
      let idx = this.vocabIndex.get(token);
      if (idx === undefined) {
        idx = this.vocabCounter++;
        this.vocabIndex.set(token, idx);
      }
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }

    // Sparse to dense (truncated to vocab size, max 2048 dims)
    const maxDim = Math.min(this.vocabCounter, 2048);
    const vec = new Array(maxDim).fill(0);
    for (const [idx, count] of tf) {
      if (idx < maxDim) {
        vec[idx] = count / tokens.length; // normalized TF
      }
    }

    return vec;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;

    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    // Account for extra dimensions
    for (let i = len; i < a.length; i++) magA += a[i] * a[i];
    for (let i = len; i < b.length; i++) magB += b[i] * b[i];

    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private calculateImportance(content: string, metadata: Record<string, unknown>): number {
    let score = 0.5;

    // Longer content = slightly more important
    if (content.length > 200) score += 0.1;
    if (content.length > 500) score += 0.1;

    // Questions are important
    if (content.includes('?')) score += 0.05;

    // User-flagged importance
    if (metadata.important === true) score += 0.2;

    // Contains code
    if (content.includes('```') || content.includes('function ') || content.includes('const ')) score += 0.05;

    return Math.min(1, score);
  }

  private evictLowest(): void {
    let lowestId = '';
    let lowestScore = Infinity;

    for (const [id, entry] of this.entries) {
      const recency = Math.max(0, 1 - (Date.now() - entry.timestamp) / (30 * 24 * 60 * 60 * 1000));
      const combined = entry.importance * 0.6 + recency * 0.4;
      if (combined < lowestScore) {
        lowestScore = combined;
        lowestId = id;
      }
    }

    if (lowestId) {
      this.entries.delete(lowestId);
    }
  }
}

export function createMemoryManager(config?: Partial<MemoryConfig>): MemoryManager {
  return new MemoryManager(config);
}
