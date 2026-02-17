import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:RSS');

export interface RSSFeed {
  id: string;
  url: string;
  title?: string;
  description?: string;
  lastFetchedAt?: number;
  interval: number;
  enabled: boolean;
  items: RSSItem[];
}

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  author?: string;
  guid?: string;
}

export class RSSFeedManager {
  private feeds: Map<string, RSSFeed> = new Map();
  private feedCounter = 0;

  constructor() {
    logger.info('RSS feed manager initialized');
  }

  addFeed(url: string, interval = 3600000): RSSFeed {
    const id = `feed-${++this.feedCounter}`;
    const feed: RSSFeed = { id, url, interval, enabled: true, items: [] };
    this.feeds.set(id, feed);
    logger.info('Feed added', { id, url });
    return feed;
  }

  removeFeed(id: string): boolean {
    return this.feeds.delete(id);
  }

  async fetchFeed(id: string): Promise<RSSItem[]> {
    const feed = this.feeds.get(id);
    if (!feed || !feed.enabled) return [];

    try {
      const res = await fetch(feed.url, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      });
      if (!res.ok) return [];

      const xml = await res.text();
      const items = this.parseRSS(xml);

      feed.items = items;
      feed.lastFetchedAt = Date.now();
      feed.title = this.extractTag(xml, 'title');
      feed.description = this.extractTag(xml, 'description');

      logger.info('Feed fetched', { id, items: items.length });
      return items;
    } catch (err) {
      logger.error('Feed fetch failed', { id, error: String(err) });
      return [];
    }
  }

  async fetchAll(): Promise<Map<string, RSSItem[]>> {
    const results = new Map<string, RSSItem[]>();
    for (const feed of this.feeds.values()) {
      if (!feed.enabled) continue;
      const items = await this.fetchFeed(feed.id);
      results.set(feed.id, items);
    }
    return results;
  }

  getFeeds(): RSSFeed[] {
    return Array.from(this.feeds.values()).map(f => ({
      ...f,
      items: f.items.slice(0, 5),
    }));
  }

  getFeed(id: string): RSSFeed | undefined {
    return this.feeds.get(id);
  }

  private parseRSS(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      items.push({
        title: this.extractTag(block, 'title') ?? '',
        link: this.extractTag(block, 'link') ?? '',
        description: (this.extractTag(block, 'description') ?? '').replace(/<[^>]*>/g, '').slice(0, 300),
        pubDate: this.extractTag(block, 'pubDate') ?? undefined,
        author: this.extractTag(block, 'author') ?? this.extractTag(block, 'dc:creator') ?? undefined,
        guid: this.extractTag(block, 'guid') ?? undefined,
      });
    }

    // Try Atom format if no RSS items found
    if (items.length === 0) {
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      while ((match = entryRegex.exec(xml)) !== null) {
        const block = match[1];
        const linkMatch = block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/);
        items.push({
          title: this.extractTag(block, 'title') ?? '',
          link: linkMatch?.[1] ?? this.extractTag(block, 'link') ?? '',
          description: (this.extractTag(block, 'summary') ?? this.extractTag(block, 'content') ?? '').replace(/<[^>]*>/g, '').slice(0, 300),
          pubDate: this.extractTag(block, 'published') ?? this.extractTag(block, 'updated') ?? undefined,
          author: this.extractTag(block, 'name') ?? undefined,
          guid: this.extractTag(block, 'id') ?? undefined,
        });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    // Handle CDATA
    const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();

    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : undefined;
  }
}

export function createRSSFeedManager(): RSSFeedManager {
  return new RSSFeedManager();
}
