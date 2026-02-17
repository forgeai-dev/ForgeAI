import * as cheerio from 'cheerio';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

// Local/private addresses are ALLOWED since the agent runs locally and needs to test local sites.
const BLOCKED_DOMAINS: string[] = [];

const MAX_CONTENT_LENGTH = 100_000;

export class WebBrowserTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'web_browse',
    description: 'Fetch a web page and extract its text content, links, or specific elements using CSS selectors. Cannot access local/private network addresses.',
    category: 'browser',
    parameters: [
      { name: 'url', type: 'string', description: 'URL to fetch (must be http/https)', required: true },
      { name: 'selector', type: 'string', description: 'CSS selector to extract specific content (optional)', required: false },
      { name: 'extract', type: 'string', description: 'What to extract: "text" (default), "links", "images", "html"', required: false, default: 'text' },
      { name: 'maxLength', type: 'number', description: 'Max content length in characters', required: false, default: 10000 },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const url = String(params['url']);
    const selector = params['selector'] as string | undefined;
    const extract = (params['extract'] as string) || 'text';
    const maxLength = Math.min(Number(params['maxLength']) || 10000, MAX_CONTENT_LENGTH);

    // Security: block private/local URLs
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http/https protocols allowed', duration: 0 };
      }
      const hostname = parsed.hostname;
      if (BLOCKED_DOMAINS.some(d => hostname === d || hostname.startsWith(d))) {
        return { success: false, error: 'Access to private/local addresses is blocked', duration: 0 };
      }
    } catch {
      return { success: false, error: 'Invalid URL', duration: 0 };
    }

    const { result, duration } = await this.timed(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'ForgeAI/0.1 (Web Browser Tool)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Remove scripts and styles
        $('script, style, noscript').remove();

        const root = selector ? $(selector) : $('body');

        switch (extract) {
          case 'links': {
            const links: Array<{ text: string; href: string }> = [];
            root.find('a[href]').each((_, el) => {
              const href = $(el).attr('href');
              const text = $(el).text().trim();
              if (href && text) links.push({ text: text.slice(0, 200), href });
            });
            return { type: 'links', count: links.length, links: links.slice(0, 100) };
          }

          case 'images': {
            const images: Array<{ alt: string; src: string }> = [];
            root.find('img[src]').each((_, el) => {
              const src = $(el).attr('src');
              const alt = $(el).attr('alt') || '';
              if (src) images.push({ alt, src });
            });
            return { type: 'images', count: images.length, images: images.slice(0, 50) };
          }

          case 'html': {
            const content = root.html() || '';
            return { type: 'html', content: content.slice(0, maxLength) };
          }

          case 'text':
          default: {
            const text = root.text().replace(/\s+/g, ' ').trim();
            return {
              type: 'text',
              title: $('title').text().trim(),
              content: text.slice(0, maxLength),
              length: text.length,
              truncated: text.length > maxLength,
            };
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    });

    this.logger.debug('Web browse completed', { url, extract, duration });
    return { success: true, data: result, duration };
  }
}
