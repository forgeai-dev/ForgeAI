import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:Memory');

// ─── Types ───────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  timestamp: number;
  sessionId?: string;
  agentId?: string;
  importance: number;
  memoryType: string;
  embeddingProvider: string;
  accessCount: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemoryEntity {
  name: string;
  type: string; // person, project, technology, preference, location, organization
  memoryId: string;
}

export type EmbeddingProviderType = 'tfidf' | 'openai';

export interface MemoryConfig {
  maxEntries: number;
  similarityThreshold: number;
  autoConsolidate: boolean;
  consolidateAfter: number;
  embeddingProvider: EmbeddingProviderType;
  embeddingModel: string;
  extractEntities: boolean;
}

/**
 * Persistence adapter interface — implemented by MemoryStore in core package.
 * Optional: if not provided, memory is in-memory only (legacy behavior).
 */
export interface MemoryPersistence {
  insert(entry: {
    id: string;
    content: string;
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    sessionId?: string;
    agentId?: string;
    memoryType: string;
    importance: number;
    embeddingProvider: string;
  }): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteByIds(ids: string[]): Promise<number>;
  loadAll(): Promise<Array<{
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
    created_at: Date;
  }>>;
  updateAccessCount(id: string): Promise<void>;
  insertEntity(entity: {
    id: string;
    name: string;
    entityType: string;
    memoryId: string;
    attributes?: Record<string, unknown>;
  }): Promise<void>;
  count(): Promise<number>;
}

// ─── Stop Words (EN + PT) ────────────────────────────

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'against',
  'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
  'them', 'his', 'her', 'their', 'my', 'your', 'our', 'we', 'you',
  'what', 'which', 'who', 'whom', 'up', 'also', 'get', 'got',
  // Portuguese
  'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos',
  'um', 'uma', 'uns', 'umas', 'para', 'por', 'com', 'sem', 'sob',
  'sobre', 'entre', 'que', 'se', 'ou', 'mas', 'como', 'mais', 'menos',
  'muito', 'pouco', 'todo', 'toda', 'todos', 'todas', 'esse', 'essa',
  'isso', 'este', 'esta', 'isto', 'aquele', 'aquela', 'aquilo',
  'ele', 'ela', 'eles', 'elas', 'seu', 'sua', 'seus', 'suas',
  'meu', 'minha', 'meus', 'minhas', 'nosso', 'nossa', 'nossos', 'nossas',
  'foi', 'ser', 'estar', 'ter', 'fazer', 'pode', 'vai', 'vou',
  'tem', 'tinha', 'est\u00e1', 'era', 'foram', 'quando', 'onde', 'porque',
  'ainda', 'j\u00e1', 'agora', 'aqui', 'ali', 'assim', 'bem', 'depois',
  'ent\u00e3o', 'mesmo', 'at\u00e9', 'ao', 'aos', '\u00e0', '\u00e0s',
]);

// ─── Lightweight Stemmer (EN + PT) ───────────────────

function stem(word: string): string {
  if (word.length <= 3) return word;

  // Portuguese suffixes (most specific first)
  const ptSuffixes = [
    'amentos', 'imento', 'amento', 'idades', 'idade', 'mente',
    'ações', 'ação', 'ções', 'ção', 'istas', 'ista',
    'ável', 'ível', 'ando', 'endo', 'indo', 'ondo',
    'ados', 'idos', 'ado', 'ido', 'ante', 'ente',
    'ores', 'oras', 'eiro', 'eira', 'oso', 'osa',
    'ar', 'er', 'ir', 'ou', 'es', 'as', 'os',
  ];

  // English suffixes
  const enSuffixes = [
    'ational', 'ization', 'fulness', 'ousness', 'iveness',
    'ations', 'ation', 'ments', 'ment', 'ness', 'ible', 'able',
    'ings', 'tion', 'sion', 'ally', 'ical', 'ful', 'ous',
    'ive', 'ing', 'ies', 'ess', 'ers', 'ent', 'ant',
    'ize', 'ise', 'ate', 'ity', 'ism',
    'ly', 'ed', 'er', 'es',
  ];

  const allSuffixes = [...ptSuffixes, ...enSuffixes];
  for (const suffix of allSuffixes) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }

  // Trailing 's' (plural) — keep at least 3 chars
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }

  return word;
}

// ─── Entity Extraction Patterns ──────────────────────

const ENTITY_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  // Technology/tool names (capitalized or known patterns)
  { type: 'technology', pattern: /\b(?:React|Vue|Angular|Next\.?js|Node\.?js|Python|TypeScript|JavaScript|Docker|MySQL|PostgreSQL|Redis|MongoDB|Tailwind|Fastify|Express|Flask|Django|Rust|Go|Java|Kotlin|Swift)\b/gi },
  // Project/product names (often PascalCase or specific patterns)
  { type: 'project', pattern: /\b(?:ForgeAI|OpenStinger|OpenClaw|CrewAI|AutoGPT|LangChain|LlamaIndex|GitHub|GitLab|Notion|Slack|Discord|Telegram|WhatsApp)\b/g },
  // URLs and domains
  { type: 'location', pattern: /https?:\/\/[^\s]+/g },
  // File paths
  { type: 'project', pattern: /(?:packages|src|dist|node_modules)\/[\w/.+-]+/g },
];

// ─── MemoryManager ───────────────────────────────────

export class MemoryManager {
  private entries: Map<string, MemoryEntry> = new Map();
  private config: MemoryConfig;
  private persistence: MemoryPersistence | null = null;
  private vocabIndex: Map<string, number> = new Map();
  private vocabReverse: Map<number, string> = new Map();
  private vocabCounter = 0;
  private idfCache: Map<string, number> = new Map();
  private idfDirty = false;
  private initialized = false;
  private openaiApiKey: string | null = null;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 10000,
      similarityThreshold: config?.similarityThreshold ?? 0.3,
      autoConsolidate: config?.autoConsolidate ?? true,
      consolidateAfter: config?.consolidateAfter ?? 1000,
      embeddingProvider: config?.embeddingProvider ?? 'tfidf',
      embeddingModel: config?.embeddingModel ?? 'text-embedding-3-small',
      extractEntities: config?.extractEntities ?? true,
    };
    logger.info('Memory manager initialized', { maxEntries: this.config.maxEntries });
  }

  /**
   * Attach MySQL persistence adapter. Call before initialize().
   */
  setPersistence(store: MemoryPersistence): void {
    this.persistence = store;
  }

  /**
   * Set OpenAI API key for real embeddings. If not set, falls back to TF-IDF.
   */
  setOpenAIKey(key: string): void {
    this.openaiApiKey = key;
    if (this.config.embeddingProvider === 'openai' || key) {
      this.config.embeddingProvider = 'openai';
      logger.info('OpenAI embeddings enabled', { model: this.config.embeddingModel });
    }
  }

  /**
   * Load all entries from MySQL into the in-memory cache.
   * Must be called after setPersistence() for persistent memory.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.persistence) {
      logger.info('Memory running in-memory only (no persistence adapter)');
      return;
    }

    try {
      const rows = await this.persistence.loadAll();
      for (const row of rows) {
        const embedding = row.embedding_json ? JSON.parse(row.embedding_json) as number[] : [];
        const metadata = row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : {};

        this.entries.set(row.id, {
          id: row.id,
          content: row.content,
          metadata,
          embedding,
          timestamp: new Date(row.created_at).getTime(),
          sessionId: row.session_id ?? undefined,
          agentId: row.agent_id ?? undefined,
          importance: Number(row.importance),
          memoryType: row.memory_type,
          embeddingProvider: row.embedding_provider,
          accessCount: row.access_count,
        });

        // Rebuild TF-IDF vocab from loaded entries
        if (row.embedding_provider === 'tfidf') {
          this.rebuildVocabFromContent(row.content);
        }
      }

      logger.info('Memory loaded from MySQL', {
        entries: this.entries.size,
        embeddingProvider: this.config.embeddingProvider,
      });
    } catch (err) {
      logger.warn('Failed to load memory from MySQL, running in-memory only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Core Operations ────────────────────────────────

  store(id: string, content: string, metadata: Record<string, unknown> = {}, sessionId?: string): MemoryEntry {
    const embedding = this.embedTFIDF(content);
    const importance = this.calculateImportance(content, metadata);
    const memoryType = (metadata.type as string) ?? 'general';
    const agentId = metadata.agentId as string | undefined;

    const entry: MemoryEntry = {
      id,
      content,
      metadata,
      embedding,
      timestamp: Date.now(),
      sessionId,
      agentId,
      importance,
      memoryType,
      embeddingProvider: 'tfidf',
      accessCount: 0,
    };

    this.entries.set(id, entry);

    // Persist to MySQL (fire-and-forget)
    if (this.persistence) {
      this.persistEntry(entry);
    }

    // Extract entities (fire-and-forget)
    if (this.config.extractEntities && this.persistence) {
      this.extractAndStoreEntities(id, content);
    }

    // Evict low-importance entries if over limit
    if (this.entries.size > this.config.maxEntries) {
      this.evictLowest();
    }

    // Auto-consolidate
    if (this.config.autoConsolidate && this.entries.size > 0 && this.entries.size % this.config.consolidateAfter === 0) {
      this.consolidate();
    }

    logger.debug('Memory stored', { id, importance: importance.toFixed(2), type: memoryType });
    return entry;
  }

  /**
   * Store with real OpenAI embedding (async). Falls back to TF-IDF on error.
   */
  async storeAsync(id: string, content: string, metadata: Record<string, unknown> = {}, sessionId?: string): Promise<MemoryEntry> {
    if (this.config.embeddingProvider !== 'openai' || !this.openaiApiKey) {
      return this.store(id, content, metadata, sessionId);
    }

    let embedding: number[];
    let provider: EmbeddingProviderType = 'openai';
    try {
      embedding = await this.embedOpenAI(content);
    } catch {
      embedding = this.embedTFIDF(content);
      provider = 'tfidf';
    }

    const importance = this.calculateImportance(content, metadata);
    const memoryType = (metadata.type as string) ?? 'general';
    const agentId = metadata.agentId as string | undefined;

    const entry: MemoryEntry = {
      id,
      content,
      metadata,
      embedding,
      timestamp: Date.now(),
      sessionId,
      agentId,
      importance,
      memoryType,
      embeddingProvider: provider,
      accessCount: 0,
    };

    this.entries.set(id, entry);

    if (this.persistence) {
      this.persistEntry(entry);
    }

    if (this.config.extractEntities && this.persistence) {
      this.extractAndStoreEntities(id, content);
    }

    if (this.entries.size > this.config.maxEntries) {
      this.evictLowest();
    }

    logger.debug('Memory stored (async)', { id, provider, importance: importance.toFixed(2) });
    return entry;
  }

  search(query: string, limit = 10, sessionId?: string): MemorySearchResult[] {
    const queryEmbedding = this.embedTFIDF(query);
    const results: MemorySearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (sessionId && entry.sessionId && entry.sessionId !== sessionId) continue;

      // Use cosine similarity — works with both TF-IDF and OpenAI embeddings of same provider
      // Cross-provider comparison uses TF-IDF fallback
      let score: number;
      if (entry.embeddingProvider === 'tfidf') {
        score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      } else {
        // For OpenAI embeddings, use TF-IDF for the query-side comparison
        // This is a trade-off: real search should use searchAsync for full accuracy
        score = this.cosineSimilarity(queryEmbedding, this.embedTFIDF(entry.content));
      }

      if (score >= this.config.similarityThreshold) {
        results.push({ entry, score });
        // Track access
        if (this.persistence) {
          this.persistence.updateAccessCount(entry.id).catch(() => {});
        }
        entry.accessCount++;
      }
    }

    results.sort((a, b) => {
      const now = Date.now();
      const recencyA = Math.max(0, 1 - (now - a.entry.timestamp) / (7 * 24 * 60 * 60 * 1000));
      const recencyB = Math.max(0, 1 - (now - b.entry.timestamp) / (7 * 24 * 60 * 60 * 1000));
      const weightedA = a.score * 0.7 + a.entry.importance * 0.2 + recencyA * 0.1;
      const weightedB = b.score * 0.7 + b.entry.importance * 0.2 + recencyB * 0.1;
      return weightedB - weightedA;
    });

    return results.slice(0, limit);
  }

  /**
   * Search using OpenAI embeddings for the query (most accurate when entries also use OpenAI).
   */
  async searchAsync(query: string, limit = 10, sessionId?: string): Promise<MemorySearchResult[]> {
    if (this.config.embeddingProvider !== 'openai' || !this.openaiApiKey) {
      return this.search(query, limit, sessionId);
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embedOpenAI(query);
    } catch {
      return this.search(query, limit, sessionId);
    }

    const results: MemorySearchResult[] = [];
    for (const entry of this.entries.values()) {
      if (sessionId && entry.sessionId && entry.sessionId !== sessionId) continue;

      let score: number;
      if (entry.embeddingProvider === 'openai' && entry.embedding.length > 0) {
        score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      } else {
        // Fallback to TF-IDF comparison for entries without OpenAI embeddings
        score = this.cosineSimilarity(this.embedTFIDF(query), this.embedTFIDF(entry.content));
      }

      if (score >= this.config.similarityThreshold) {
        results.push({ entry, score });
        if (this.persistence) {
          this.persistence.updateAccessCount(entry.id).catch(() => {});
        }
        entry.accessCount++;
      }
    }

    results.sort((a, b) => {
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
    const deleted = this.entries.delete(id);
    if (deleted && this.persistence) {
      this.persistence.delete(id).catch(() => {});
    }
    return deleted;
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
    const toRemove = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      if (toRemove.has(entries[i].id)) continue;
      for (let j = i + 1; j < entries.length; j++) {
        if (toRemove.has(entries[j].id)) continue;

        // Only compare entries with same embedding provider
        if (entries[i].embeddingProvider !== entries[j].embeddingProvider) continue;

        const similarity = this.cosineSimilarity(entries[i].embedding, entries[j].embedding);
        if (similarity > 0.9) {
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

    // Persist removals
    if (toRemove.size > 0 && this.persistence) {
      this.persistence.deleteByIds(Array.from(toRemove)).catch(() => {});
    }

    if (merged > 0) logger.info('Memory consolidated', { merged, removed });
    return { merged, removed };
  }

  getStats(): { total: number; sessions: number; avgImportance: number; oldestMs: number; persistent: boolean; embeddingProvider: string } {
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
      persistent: this.persistence !== null,
      embeddingProvider: this.config.embeddingProvider,
    };
  }

  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  clear(): void {
    this.entries.clear();
    logger.info('Memory cleared');
  }

  // ─── Persistence Helpers ────────────────────────────

  private persistEntry(entry: MemoryEntry): void {
    if (!this.persistence) return;
    this.persistence.insert({
      id: entry.id,
      content: entry.content,
      embedding: entry.embedding.length > 0 ? entry.embedding : null,
      metadata: entry.metadata,
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      memoryType: entry.memoryType,
      importance: entry.importance,
      embeddingProvider: entry.embeddingProvider,
    }).catch(err => {
      logger.warn('Failed to persist memory entry', { id: entry.id, error: err instanceof Error ? err.message : String(err) });
    });
  }

  // ─── Entity Extraction ──────────────────────────────

  private extractAndStoreEntities(memoryId: string, content: string): void {
    if (!this.persistence) return;

    const seen = new Set<string>();
    for (const { type, pattern } of ENTITY_PATTERNS) {
      const matches = content.match(pattern);
      if (!matches) continue;

      for (const match of matches) {
        const normalized = match.trim();
        const key = `${type}:${normalized.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const entityId = `ent-${memoryId.slice(0, 16)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        this.persistence.insertEntity({
          id: entityId,
          name: normalized,
          entityType: type,
          memoryId,
        }).catch(() => {});
      }
    }
  }

  // ─── TF-IDF Embedding (Enhanced) ───────────────────

  private embedTFIDF(text: string): number[] {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return [];

    const tf = new Map<number, number>();

    for (const token of tokens) {
      let idx = this.vocabIndex.get(token);
      if (idx === undefined) {
        idx = this.vocabCounter++;
        this.vocabIndex.set(token, idx);
        this.vocabReverse.set(idx, token);
        this.idfDirty = true;
      }
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }

    // Rebuild IDF periodically (not on every call for performance)
    if (this.idfDirty && this.entries.size > 0 && this.entries.size % 10 === 0) {
      this.rebuildIDF();
    }

    const maxDim = Math.min(this.vocabCounter, 2048);
    const vec = new Array(maxDim).fill(0);
    for (const [idx, count] of tf) {
      if (idx < maxDim) {
        const tfNorm = count / tokens.length;
        // Look up IDF weight for this term
        const token = this.vocabReverseLookup(idx);
        const idf = token ? (this.idfCache.get(token) ?? 1.0) : 1.0;
        vec[idx] = tfNorm * idf;
      }
    }

    return vec;
  }

  private vocabReverseLookup(idx: number): string | undefined {
    return this.vocabReverse.get(idx);
  }

  private rebuildIDF(): void {
    this.idfCache.clear();
    this.idfDirty = false;
    const N = this.entries.size || 1;
    const docFreq = new Map<string, number>();

    for (const entry of this.entries.values()) {
      const tokens = new Set(this.tokenize(entry.content));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    for (const [token, df] of docFreq) {
      // Standard IDF: log(N / df) + 1 (smoothed)
      this.idfCache.set(token, Math.log(N / (df + 1)) + 1);
    }
  }

  private rebuildVocabFromContent(content: string): void {
    const tokens = this.tokenize(content);
    for (const token of tokens) {
      if (!this.vocabIndex.has(token)) {
        const idx = this.vocabCounter++;
        this.vocabIndex.set(token, idx);
        this.vocabReverse.set(idx, token);
      }
    }
  }

  // ─── OpenAI Embedding ─────────────────────────────

  private async embedOpenAI(text: string): Promise<number[]> {
    if (!this.openaiApiKey) throw new Error('No OpenAI API key');

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: text.slice(0, 8000), // text-embedding-3-small max ~8k tokens
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings failed: ${response.status}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  // ─── Utilities ─────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
      .filter(t => !STOP_WORDS.has(t))  // Remove stop words (EN + PT)
      .map(t => stem(t));               // Apply lightweight stemming
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;

    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    for (let i = len; i < a.length; i++) magA += a[i] * a[i];
    for (let i = len; i < b.length; i++) magB += b[i] * b[i];

    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private calculateImportance(content: string, metadata: Record<string, unknown>): number {
    let score = 0.5;

    if (content.length > 200) score += 0.1;
    if (content.length > 500) score += 0.1;
    if (content.includes('?')) score += 0.05;
    if (metadata.important === true) score += 0.2;
    if (content.includes('```') || content.includes('function ') || content.includes('const ')) score += 0.05;

    // Learnings are more important
    if (metadata.type === 'learning') score += 0.1;

    // User preferences are highly important
    if (metadata.type === 'user_preference') score += 0.15;

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
      this.delete(lowestId); // uses delete() which also removes from MySQL
    }
  }
}

export function createMemoryManager(config?: Partial<MemoryConfig>): MemoryManager {
  return new MemoryManager(config);
}
