import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createLogger, generateId } from '@forgeai/shared';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

const logger = createLogger('Tool:KnowledgeBase');

interface Document {
  id: string;
  title: string;
  content: string;
  tags: string[];
  tokens: string[];
  createdAt: string;
  updatedAt: string;
}

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  tags: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function computeTFIDF(queryTokens: string[], docTokens: string[], allDocs: Document[]): number {
  let score = 0;
  const docTokenSet = new Set(docTokens);
  const totalDocs = allDocs.length || 1;

  for (const qt of queryTokens) {
    if (!docTokenSet.has(qt)) continue;

    // TF: frequency in document
    const tf = docTokens.filter(t => t === qt).length / (docTokens.length || 1);

    // IDF: inverse document frequency
    const docsWithTerm = allDocs.filter(d => d.tokens.includes(qt)).length || 1;
    const idf = Math.log(totalDocs / docsWithTerm);

    score += tf * idf;
  }

  return score;
}

export class KnowledgeBaseTool extends BaseTool {
  private storePath: string;
  private documents: Document[] = [];
  private loaded = false;

  readonly definition: ToolDefinition = {
    name: 'knowledge_base',
    description: 'Store, search, and retrieve documents in a local knowledge base. Uses TF-IDF for semantic-like search. Supports add, search, get, list, delete operations.',
    category: 'knowledge',
    parameters: [
      { name: 'action', type: 'string', description: 'Action: "add", "search", "get", "list", "delete", "update"', required: true },
      { name: 'title', type: 'string', description: 'Document title (for add/update)', required: false },
      { name: 'content', type: 'string', description: 'Document content (for add/update)', required: false },
      { name: 'tags', type: 'array', description: 'Tags array (for add/update/search filter)', required: false },
      { name: 'query', type: 'string', description: 'Search query (for search)', required: false },
      { name: 'id', type: 'string', description: 'Document ID (for get/delete/update)', required: false },
      { name: 'limit', type: 'number', description: 'Max results (for search/list, default 10)', required: false, default: 10 },
    ],
  };

  constructor(storePath?: string) {
    super();
    this.storePath = storePath || resolve(process.cwd(), '.forgeai', 'knowledge');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (!existsSync(this.storePath)) {
      await mkdir(this.storePath, { recursive: true });
    }

    const indexPath = join(this.storePath, 'index.json');
    if (existsSync(indexPath)) {
      try {
        const raw = await readFile(indexPath, 'utf-8');
        this.documents = JSON.parse(raw);
      } catch {
        this.documents = [];
      }
    }

    this.loaded = true;
    logger.info(`Knowledge base loaded: ${this.documents.length} documents`);
  }

  private async save(): Promise<void> {
    const indexPath = join(this.storePath, 'index.json');
    await writeFile(indexPath, JSON.stringify(this.documents, null, 2), 'utf-8');
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    await this.ensureLoaded();

    const action = String(params['action']);
    const limit = Math.min(Number(params['limit']) || 10, 50);

    const { result, duration } = await this.timed(async () => {
      switch (action) {
        case 'add': {
          const title = String(params['title'] || 'Untitled');
          const content = String(params['content'] || '');
          const tags = (params['tags'] as string[]) || [];

          if (!content.trim()) throw new Error('Content is required');

          const doc: Document = {
            id: generateId('doc'),
            title,
            content,
            tags,
            tokens: tokenize(`${title} ${content}`),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          this.documents.push(doc);
          await this.save();

          logger.info('Document added', { id: doc.id, title });
          return { id: doc.id, title, tags, tokenCount: doc.tokens.length };
        }

        case 'search': {
          const query = String(params['query'] || '');
          const tags = (params['tags'] as string[]) || [];

          if (!query.trim() && tags.length === 0) {
            throw new Error('Provide a query and/or tags to search');
          }

          const queryTokens = tokenize(query);

          let candidates = this.documents;
          if (tags.length > 0) {
            candidates = candidates.filter(d =>
              tags.some(tag => d.tags.includes(tag))
            );
          }

          const results: SearchResult[] = candidates
            .map(doc => {
              const score = query.trim()
                ? computeTFIDF(queryTokens, doc.tokens, this.documents)
                : 1;
              return {
                id: doc.id,
                title: doc.title,
                snippet: doc.content.slice(0, 300),
                score,
                tags: doc.tags,
              };
            })
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          return { query, count: results.length, results };
        }

        case 'get': {
          const id = String(params['id'] || '');
          const doc = this.documents.find(d => d.id === id);
          if (!doc) throw new Error(`Document not found: ${id}`);
          return {
            id: doc.id,
            title: doc.title,
            content: doc.content,
            tags: doc.tags,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          };
        }

        case 'list': {
          const items = this.documents
            .slice(-limit)
            .reverse()
            .map(d => ({
              id: d.id,
              title: d.title,
              tags: d.tags,
              contentLength: d.content.length,
              createdAt: d.createdAt,
            }));
          return { count: this.documents.length, shown: items.length, items };
        }

        case 'update': {
          const id = String(params['id'] || '');
          const doc = this.documents.find(d => d.id === id);
          if (!doc) throw new Error(`Document not found: ${id}`);

          if (params['title']) doc.title = String(params['title']);
          if (params['content']) {
            doc.content = String(params['content']);
            doc.tokens = tokenize(`${doc.title} ${doc.content}`);
          }
          if (params['tags']) doc.tags = params['tags'] as string[];
          doc.updatedAt = new Date().toISOString();

          await this.save();
          return { updated: true, id: doc.id, title: doc.title };
        }

        case 'delete': {
          const id = String(params['id'] || '');
          const idx = this.documents.findIndex(d => d.id === id);
          if (idx === -1) throw new Error(`Document not found: ${id}`);
          this.documents.splice(idx, 1);
          await this.save();
          return { deleted: true, id };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    });

    return { success: true, data: result, duration };
  }

  getDocumentCount(): number {
    return this.documents.length;
  }
}
