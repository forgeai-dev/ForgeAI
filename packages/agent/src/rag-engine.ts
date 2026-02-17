import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:RAG');

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

export interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  similarityThreshold: number;
}

export class RAGEngine {
  private documents: Map<string, RAGDocument> = new Map();
  private chunks: RAGChunk[] = [];
  private config: RAGConfig;
  private vocabIndex: Map<string, number> = new Map();
  private vocabCounter = 0;
  private idfCache: Map<string, number> = new Map();

  constructor(config?: Partial<RAGConfig>) {
    this.config = {
      chunkSize: config?.chunkSize ?? 512,
      chunkOverlap: config?.chunkOverlap ?? 64,
      maxResults: config?.maxResults ?? 5,
      similarityThreshold: config?.similarityThreshold ?? 0.15,
    };
    logger.info('RAG engine initialized', { chunkSize: this.config.chunkSize });
  }

  ingest(id: string, content: string, metadata: Record<string, unknown> = {}): RAGDocument {
    // Remove existing document if re-ingesting
    if (this.documents.has(id)) this.remove(id);

    // Split into chunks
    const textChunks = this.splitIntoChunks(content);
    const chunks: RAGChunk[] = textChunks.map((text, i) => ({
      id: `${id}:chunk-${i}`,
      documentId: id,
      content: text,
      embedding: this.embed(text),
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

    logger.info('Document ingested', { id, chunks: chunks.length, contentLength: content.length });
    return doc;
  }

  search(query: string, maxResults?: number): RAGSearchResult[] {
    const queryEmbedding = this.embed(query);
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

export function createRAGEngine(config?: Partial<RAGConfig>): RAGEngine {
  return new RAGEngine(config);
}
