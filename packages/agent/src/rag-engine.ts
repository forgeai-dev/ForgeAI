import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:RAG');

const RAG_DATA_DIR = resolve(process.cwd(), '.forgeai', 'rag');
const RAG_CONFIG_FILE = resolve(RAG_DATA_DIR, '_config.json');

export interface RAGDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  chunks: RAGChunk[];
  createdAt: number;
}

export interface RAGChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  position: number;
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  document: RAGDocument;
  score: number;
}

export type EmbeddingProvider = 'tfidf' | 'openai';

export interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  similarityThreshold: number;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  persist: boolean;
}

interface PersistedDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export class RAGEngine {
  private documents: Map<string, RAGDocument> = new Map();
  private chunks: RAGChunk[] = [];
  private config: RAGConfig;
  private vocabIndex: Map<string, number> = new Map();
  private vocabCounter = 0;
  private idfCache: Map<string, number> = new Map();
  private openaiEmbeddingCache: Map<string, number[]> = new Map();

  constructor(config?: Partial<RAGConfig>) {
    this.config = {
      chunkSize: config?.chunkSize ?? 512,
      chunkOverlap: config?.chunkOverlap ?? 64,
      maxResults: config?.maxResults ?? 5,
      similarityThreshold: config?.similarityThreshold ?? 0.15,
      embeddingProvider: config?.embeddingProvider ?? 'tfidf',
      embeddingModel: config?.embeddingModel ?? 'text-embedding-3-small',
      persist: config?.persist ?? true,
    };

    // Load persisted config if available
    this.loadConfig();
    // Auto-load persisted documents
    this.loadPersistedDocuments();

    logger.info('RAG engine initialized', {
      chunkSize: this.config.chunkSize,
      embedding: this.config.embeddingProvider,
      documents: this.documents.size,
      persist: this.config.persist,
    });
  }

  async ingestAsync(id: string, content: string, metadata: Record<string, unknown> = {}): Promise<RAGDocument> {
    // Remove existing document if re-ingesting
    if (this.documents.has(id)) this.remove(id);

    // Split into chunks
    const textChunks = this.splitIntoChunks(content);
    const chunks: RAGChunk[] = [];

    if (this.config.embeddingProvider === 'openai') {
      // Batch embed with OpenAI
      const embeddings = await this.embedOpenAIBatch(textChunks);
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          id: `${id}:chunk-${i}`,
          documentId: id,
          content: textChunks[i],
          embedding: embeddings[i] ?? this.embedTFIDF(textChunks[i]),
          position: i,
        });
      }
    } else {
      for (let i = 0; i < textChunks.length; i++) {
        chunks.push({
          id: `${id}:chunk-${i}`,
          documentId: id,
          content: textChunks[i],
          embedding: this.embedTFIDF(textChunks[i]),
          position: i,
        });
      }
    }

    const doc: RAGDocument = {
      id,
      content,
      metadata,
      chunks,
      createdAt: Date.now(),
    };

    this.documents.set(id, doc);
    this.chunks.push(...chunks);
    if (this.config.embeddingProvider === 'tfidf') this.rebuildIDF();

    // Persist to disk
    if (this.config.persist) this.persistDocument(doc);

    logger.info('Document ingested', { id, chunks: chunks.length, contentLength: content.length, embedding: this.config.embeddingProvider });
    return doc;
  }

  ingest(id: string, content: string, metadata: Record<string, unknown> = {}): RAGDocument {
    // Synchronous ingest (TF-IDF only)
    if (this.documents.has(id)) this.remove(id);

    const textChunks = this.splitIntoChunks(content);
    const chunks: RAGChunk[] = textChunks.map((text, i) => ({
      id: `${id}:chunk-${i}`,
      documentId: id,
      content: text,
      embedding: this.embedTFIDF(text),
      position: i,
    }));

    const doc: RAGDocument = {
      id,
      content,
      metadata,
      chunks,
      createdAt: Date.now(),
    };

    this.documents.set(id, doc);
    this.chunks.push(...chunks);
    this.rebuildIDF();

    if (this.config.persist) this.persistDocument(doc);

    logger.info('Document ingested', { id, chunks: chunks.length, contentLength: content.length });
    return doc;
  }

  search(query: string, maxResults?: number): RAGSearchResult[] {
    const queryEmbedding = this.embedTFIDF(query);
    const limit = maxResults ?? this.config.maxResults;
    const results: RAGSearchResult[] = [];

    for (const chunk of this.chunks) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= this.config.similarityThreshold) {
        const document = this.documents.get(chunk.documentId);
        if (document) {
          results.push({ chunk, document, score });
        }
      }
    }

    // Sort by score descending, deduplicate by document (keep best chunk per doc)
    results.sort((a, b) => b.score - a.score);

    // Optionally deduplicate: keep top chunk per document
    const seen = new Set<string>();
    const deduped: RAGSearchResult[] = [];
    for (const r of results) {
      if (!seen.has(r.document.id) || deduped.length < limit * 2) {
        seen.add(r.document.id);
        deduped.push(r);
      }
      if (deduped.length >= limit) break;
    }

    return deduped.slice(0, limit);
  }

  buildContext(query: string, maxTokens = 2000): string {
    const results = this.search(query);
    if (results.length === 0) return '';

    let context = '';
    let approxTokens = 0;

    for (const result of results) {
      const chunk = `[Source: ${result.document.metadata.title ?? result.document.id}]\n${result.chunk.content}\n\n`;
      const chunkTokens = Math.ceil(chunk.length / 4);
      if (approxTokens + chunkTokens > maxTokens) break;
      context += chunk;
      approxTokens += chunkTokens;
    }

    return context.trim();
  }

  remove(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    this.documents.delete(id);
    this.chunks = this.chunks.filter(c => c.documentId !== id);
    this.rebuildIDF();

    // Remove from disk
    if (this.config.persist) {
      try {
        const fp = resolve(RAG_DATA_DIR, `${this.safeFilename(id)}.json`);
        if (existsSync(fp)) unlinkSync(fp);
      } catch { /* ignore */ }
    }

    logger.info('Document removed', { id });
    return true;
  }

  getDocument(id: string): RAGDocument | undefined {
    return this.documents.get(id);
  }

  listDocuments(): Array<{ id: string; metadata: Record<string, unknown>; chunks: number; createdAt: number }> {
    return Array.from(this.documents.values()).map(d => ({
      id: d.id,
      metadata: d.metadata,
      chunks: d.chunks.length,
      createdAt: d.createdAt,
    }));
  }

  getStats(): { documents: number; chunks: number; vocabSize: number; avgChunkSize: number } {
    const avgChunkSize = this.chunks.length > 0
      ? Math.round(this.chunks.reduce((s, c) => s + c.content.length, 0) / this.chunks.length)
      : 0;
    return {
      documents: this.documents.size,
      chunks: this.chunks.length,
      vocabSize: this.vocabIndex.size,
      avgChunkSize,
    };
  }

  getConfig(): RAGConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<RAGConfig>): RAGConfig {
    if (partial.chunkSize !== undefined) this.config.chunkSize = partial.chunkSize;
    if (partial.chunkOverlap !== undefined) this.config.chunkOverlap = partial.chunkOverlap;
    if (partial.maxResults !== undefined) this.config.maxResults = partial.maxResults;
    if (partial.similarityThreshold !== undefined) this.config.similarityThreshold = partial.similarityThreshold;
    if (partial.embeddingProvider !== undefined) this.config.embeddingProvider = partial.embeddingProvider;
    if (partial.embeddingModel !== undefined) this.config.embeddingModel = partial.embeddingModel;
    if (partial.persist !== undefined) this.config.persist = partial.persist;

    // Persist config
    this.saveConfig();
    logger.info('RAG config updated', { config: this.config });
    return { ...this.config };
  }

  // ─── Persistence ─────────────────────────────────────

  private persistDocument(doc: RAGDocument): void {
    try {
      if (!existsSync(RAG_DATA_DIR)) mkdirSync(RAG_DATA_DIR, { recursive: true });
      const data: PersistedDocument = { id: doc.id, content: doc.content, metadata: doc.metadata, createdAt: doc.createdAt };
      writeFileSync(resolve(RAG_DATA_DIR, `${this.safeFilename(doc.id)}.json`), JSON.stringify(data, null, 2));
    } catch (err) {
      logger.warn('Failed to persist RAG document', { id: doc.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private loadPersistedDocuments(): void {
    if (!existsSync(RAG_DATA_DIR)) return;
    try {
      const files = readdirSync(RAG_DATA_DIR).filter(f => f.endsWith('.json') && f !== '_config.json');
      for (const file of files) {
        try {
          const raw = readFileSync(resolve(RAG_DATA_DIR, file), 'utf-8');
          const data = JSON.parse(raw) as PersistedDocument;
          if (data.id && data.content) {
            // Re-ingest silently (sync, TF-IDF only for startup speed)
            const textChunks = this.splitIntoChunks(data.content);
            const chunks: RAGChunk[] = textChunks.map((text, i) => ({
              id: `${data.id}:chunk-${i}`,
              documentId: data.id,
              content: text,
              embedding: this.embedTFIDF(text),
              position: i,
            }));
            this.documents.set(data.id, { id: data.id, content: data.content, metadata: data.metadata ?? {}, chunks, createdAt: data.createdAt ?? Date.now() });
            this.chunks.push(...chunks);
          }
        } catch { /* skip corrupt files */ }
      }
      if (this.documents.size > 0) {
        this.rebuildIDF();
        logger.info(`Loaded ${this.documents.size} persisted RAG documents`);
      }
    } catch { /* ignore */ }
  }

  private saveConfig(): void {
    try {
      if (!existsSync(RAG_DATA_DIR)) mkdirSync(RAG_DATA_DIR, { recursive: true });
      writeFileSync(RAG_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch { /* ignore */ }
  }

  private loadConfig(): void {
    if (!existsSync(RAG_CONFIG_FILE)) return;
    try {
      const raw = readFileSync(RAG_CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw) as Partial<RAGConfig>;
      if (saved.chunkSize) this.config.chunkSize = saved.chunkSize;
      if (saved.chunkOverlap) this.config.chunkOverlap = saved.chunkOverlap;
      if (saved.maxResults) this.config.maxResults = saved.maxResults;
      if (saved.similarityThreshold) this.config.similarityThreshold = saved.similarityThreshold;
      if (saved.embeddingProvider) this.config.embeddingProvider = saved.embeddingProvider;
      if (saved.embeddingModel) this.config.embeddingModel = saved.embeddingModel;
      if (saved.persist !== undefined) this.config.persist = saved.persist;
    } catch { /* ignore */ }
  }

  private safeFilename(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  }

  // ─── OpenAI Embeddings ─────────────────────────────────────

  private async embedOpenAIBatch(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('OpenAI API key not set, falling back to TF-IDF');
      return texts.map(t => this.embedTFIDF(t));
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: this.config.embeddingModel, input: texts }),
      });

      if (!response.ok) {
        logger.warn(`OpenAI embeddings failed: ${response.status}, falling back to TF-IDF`);
        return texts.map(t => this.embedTFIDF(t));
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => d.embedding);
    } catch (err) {
      logger.warn('OpenAI embeddings request failed, falling back to TF-IDF', { error: err instanceof Error ? err.message : String(err) });
      return texts.map(t => this.embedTFIDF(t));
    }
  }

  async searchAsync(query: string, maxResults?: number): Promise<RAGSearchResult[]> {
    let queryEmbedding: number[];
    if (this.config.embeddingProvider === 'openai') {
      const cached = this.openaiEmbeddingCache.get(query.slice(0, 200));
      if (cached) {
        queryEmbedding = cached;
      } else {
        const [emb] = await this.embedOpenAIBatch([query]);
        this.openaiEmbeddingCache.set(query.slice(0, 200), emb);
        queryEmbedding = emb;
      }
    } else {
      queryEmbedding = this.embedTFIDF(query);
    }

    const limit = maxResults ?? this.config.maxResults;
    const results: RAGSearchResult[] = [];
    for (const chunk of this.chunks) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= this.config.similarityThreshold) {
        const document = this.documents.get(chunk.documentId);
        if (document) results.push({ chunk, document, score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    const words = text.split(/\s+/);
    const chunkWords = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;

    for (let i = 0; i < words.length; i += chunkWords - overlap) {
      const chunk = words.slice(i, i + chunkWords).join(' ');
      if (chunk.trim().length > 0) chunks.push(chunk.trim());
      if (i + chunkWords >= words.length) break;
    }

    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push(text.trim());
    }

    return chunks;
  }

  private embedTFIDF(text: string): number[] {
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

    // TF-IDF weighted vector
    const maxDim = Math.min(this.vocabCounter, 4096);
    const vec = new Array(maxDim).fill(0);
    for (const [idx, count] of tf) {
      if (idx < maxDim) {
        const tfNorm = count / tokens.length;
        const token = Array.from(this.vocabIndex.entries()).find(([, v]) => v === idx)?.[0] ?? '';
        const idf = this.idfCache.get(token) ?? 1;
        vec[idx] = tfNorm * idf;
      }
    }

    return vec;
  }

  private rebuildIDF(): void {
    this.idfCache.clear();
    const N = this.chunks.length || 1;
    const docFreq = new Map<string, number>();

    for (const chunk of this.chunks) {
      const tokens = new Set(this.tokenize(chunk.content));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    for (const [token, df] of docFreq) {
      this.idfCache.set(token, Math.log(N / (df + 1)) + 1);
    }
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
    for (let i = len; i < a.length; i++) magA += a[i] * a[i];
    for (let i = len; i < b.length; i++) magB += b[i] * b[i];
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }
}

// ─── File content extraction ─────────────────────────────────────

export function extractTextFromFile(filename: string, buffer: Buffer): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  switch (ext) {
    case 'txt':
    case 'md':
    case 'markdown':
    case 'csv':
    case 'tsv':
    case 'log':
    case 'json':
    case 'xml':
    case 'yaml':
    case 'yml':
    case 'html':
    case 'htm':
    case 'js':
    case 'ts':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'css':
    case 'sql':
    case 'sh':
    case 'env':
    case 'ini':
    case 'toml':
    case 'cfg':
      return buffer.toString('utf-8');

    case 'pdf':
      // Basic PDF text extraction (no external deps)
      return extractPDFText(buffer);

    default:
      // Try as UTF-8 text
      try {
        const text = buffer.toString('utf-8');
        // Check if it looks like valid text (not binary)
        if (text.includes('\0')) return `[Binary file: ${filename}]`;
        return text;
      } catch {
        return `[Unsupported file format: ${ext}]`;
      }
  }
}

function extractPDFText(buffer: Buffer): string {
  // Lightweight PDF text extraction without external libraries
  // Handles basic text streams in PDF files
  const raw = buffer.toString('latin1');
  const textParts: string[] = [];

  // Find text between BT...ET (Begin Text / End Text) operators
  const btPattern = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  while ((match = btPattern.exec(raw)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjPattern = /\(([^)]*?)\)\s*Tj/g;
    let tj;
    while ((tj = tjPattern.exec(block)) !== null) {
      textParts.push(tj[1]);
    }
    // TJ array operator
    const tjArrayPattern = /\[([^\]]*)\]\s*TJ/gi;
    let tja;
    while ((tja = tjArrayPattern.exec(block)) !== null) {
      const inner = tja[1];
      const strPattern = /\(([^)]*?)\)/g;
      let s;
      while ((s = strPattern.exec(inner)) !== null) {
        textParts.push(s[1]);
      }
    }
  }

  const text = textParts.join(' ').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\s+/g, ' ').trim();
  return text || '[PDF: no extractable text found]';
}

export function createRAGEngine(config?: Partial<RAGConfig>): RAGEngine {
  return new RAGEngine(config);
}
