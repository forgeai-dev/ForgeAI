import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:Notion');

export interface NotionConfig {
  /** Notion internal integration token */
  apiKey: string;
  /** Default database ID for syncing */
  defaultDatabaseId?: string;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  icon?: string;
  archived: boolean;
  parentType: string;
  parentId: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  description: string;
  createdTime: string;
  lastEditedTime: string;
  properties: Record<string, { type: string; name: string }>;
}

export interface NotionBlock {
  id: string;
  type: string;
  content: string;
  hasChildren: boolean;
}

export interface NotionSearchResult {
  id: string;
  type: 'page' | 'database';
  title: string;
  url: string;
  lastEditedTime: string;
}

/**
 * Notion Integration using Notion API v1.
 *
 * Setup:
 * 1. Create an Internal Integration at https://www.notion.so/my-integrations
 * 2. Copy the integration token
 * 3. Share pages/databases with the integration
 *
 * Features:
 * - Search across workspace
 * - List/read pages
 * - List databases and query entries
 * - Read page content (blocks)
 * - Create pages
 * - Append blocks to pages
 */
export class NotionIntegration {
  private config: NotionConfig | null = null;
  private baseUrl = 'https://api.notion.com/v1';
  private notionVersion = '2022-06-28';

  constructor() {
    logger.info('Notion integration initialized');
  }

  configure(config: NotionConfig): void {
    this.config = config;
    logger.info('Notion configured');
  }

  isConfigured(): boolean {
    return !!this.config?.apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!this.config?.apiKey) throw new Error('Notion not configured');
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': this.notionVersion,
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const err = await res.text();
      logger.warn('Notion API error', { status: res.status, error: err });
      throw new Error(`Notion API ${res.status}: ${err}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Search ────────────────────────────────

  async search(query: string, opts?: { filter?: 'page' | 'database'; pageSize?: number }): Promise<NotionSearchResult[]> {
    const body: Record<string, unknown> = { query, page_size: opts?.pageSize ?? 20 };
    if (opts?.filter) body.filter = { value: opts.filter, property: 'object' };

    const data = await this.request<{ results: Array<Record<string, unknown>> }>('/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return (data.results ?? []).map(r => ({
      id: String(r.id ?? ''),
      type: (r.object === 'database' ? 'database' : 'page') as 'page' | 'database',
      title: this.extractTitle(r),
      url: String(r.url ?? ''),
      lastEditedTime: String(r.last_edited_time ?? ''),
    }));
  }

  // ─── Pages ─────────────────────────────────

  async getPage(pageId: string): Promise<NotionPage> {
    const data = await this.request<Record<string, unknown>>(`/pages/${pageId}`);
    return this.parsePage(data);
  }

  async getPageContent(pageId: string): Promise<NotionBlock[]> {
    const data = await this.request<{ results: Array<Record<string, unknown>> }>(
      `/blocks/${pageId}/children?page_size=100`
    );
    return (data.results ?? []).map(b => this.parseBlock(b));
  }

  async createPage(opts: {
    parentPageId?: string;
    parentDatabaseId?: string;
    title: string;
    content?: string;
    properties?: Record<string, unknown>;
  }): Promise<NotionPage> {
    const body: Record<string, unknown> = {};

    if (opts.parentDatabaseId) {
      body.parent = { database_id: opts.parentDatabaseId };
      body.properties = opts.properties ?? {
        Name: { title: [{ text: { content: opts.title } }] },
      };
    } else {
      body.parent = { page_id: opts.parentPageId };
      body.properties = {
        title: { title: [{ text: { content: opts.title } }] },
      };
    }

    if (opts.content) {
      body.children = this.textToBlocks(opts.content);
    }

    const data = await this.request<Record<string, unknown>>('/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    logger.info('Page created', { id: data.id, title: opts.title });
    return this.parsePage(data);
  }

  async appendBlocks(pageId: string, content: string): Promise<NotionBlock[]> {
    const data = await this.request<{ results: Array<Record<string, unknown>> }>(
      `/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        body: JSON.stringify({ children: this.textToBlocks(content) }),
      }
    );
    return (data.results ?? []).map(b => this.parseBlock(b));
  }

  // ─── Databases ─────────────────────────────

  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    const data = await this.request<Record<string, unknown>>(`/databases/${databaseId}`);
    return this.parseDatabase(data);
  }

  async queryDatabase(databaseId: string, opts?: {
    filter?: Record<string, unknown>;
    sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>;
    pageSize?: number;
  }): Promise<NotionPage[]> {
    const body: Record<string, unknown> = { page_size: opts?.pageSize ?? 20 };
    if (opts?.filter) body.filter = opts.filter;
    if (opts?.sorts) body.sorts = opts.sorts;

    const data = await this.request<{ results: Array<Record<string, unknown>> }>(
      `/databases/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return (data.results ?? []).map(r => this.parsePage(r));
  }

  // ─── Parsers ───────────────────────────────

  private extractTitle(obj: Record<string, unknown>): string {
    const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
    if (!props) return String(obj.title ?? '');

    for (const prop of Object.values(props)) {
      if (prop.type === 'title') {
        const titleArr = prop.title as Array<{ plain_text: string }> | undefined;
        return titleArr?.[0]?.plain_text ?? '';
      }
    }

    // Database title
    const titleArr = obj.title as Array<{ plain_text: string }> | undefined;
    return titleArr?.[0]?.plain_text ?? '';
  }

  private parsePage(data: Record<string, unknown>): NotionPage {
    const parent = data.parent as Record<string, string> | undefined;
    const icon = data.icon as Record<string, string> | undefined;
    return {
      id: String(data.id ?? ''),
      title: this.extractTitle(data),
      url: String(data.url ?? ''),
      createdTime: String(data.created_time ?? ''),
      lastEditedTime: String(data.last_edited_time ?? ''),
      icon: icon?.emoji ?? (icon?.external as Record<string, string> | undefined)?.url ?? undefined,
      archived: !!data.archived,
      parentType: parent?.type ?? '',
      parentId: parent?.page_id ?? parent?.database_id ?? '',
    };
  }

  private parseDatabase(data: Record<string, unknown>): NotionDatabase {
    const props = data.properties as Record<string, Record<string, unknown>> | undefined;
    const properties: Record<string, { type: string; name: string }> = {};
    if (props) {
      for (const [key, val] of Object.entries(props)) {
        properties[key] = { type: String(val.type ?? ''), name: String(val.name ?? key) };
      }
    }
    const titleArr = data.title as Array<{ plain_text: string }> | undefined;
    return {
      id: String(data.id ?? ''),
      title: titleArr?.[0]?.plain_text ?? '',
      url: String(data.url ?? ''),
      description: '',
      createdTime: String(data.created_time ?? ''),
      lastEditedTime: String(data.last_edited_time ?? ''),
      properties,
    };
  }

  private parseBlock(b: Record<string, unknown>): NotionBlock {
    const type = String(b.type ?? 'unsupported');
    const blockData = b[type] as Record<string, unknown> | undefined;
    let content = '';

    if (blockData?.rich_text) {
      const texts = blockData.rich_text as Array<{ plain_text: string }>;
      content = texts.map(t => t.plain_text).join('');
    } else if (blockData?.text) {
      const texts = blockData.text as Array<{ plain_text: string }>;
      content = texts.map(t => t.plain_text).join('');
    }

    return {
      id: String(b.id ?? ''),
      type,
      content,
      hasChildren: !!b.has_children,
    };
  }

  private textToBlocks(text: string): Array<Record<string, unknown>> {
    return text.split('\n').filter(l => l.trim()).map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line } }],
      },
    }));
  }
}

export function createNotionIntegration(): NotionIntegration {
  return new NotionIntegration();
}
