import * as cheerio from 'cheerio';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

// Local/private addresses are ALLOWED since the agent runs locally and needs to test local sites.
const BLOCKED_DOMAINS: string[] = [];

const MAX_CONTENT_LENGTH = 100_000;

const BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

const randomUA = () => BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];

export class WebBrowserTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'web_browse',
    description: 'Fetch web pages or APIs and extract content. Supports GET/POST/PUT/DELETE, custom headers, and multiple extraction modes: text, links, images, html, tables, metadata, json.',
    category: 'browser',
    parameters: [
      { name: 'url', type: 'string', description: 'URL to fetch (http/https)', required: true },
      { name: 'method', type: 'string', description: 'HTTP method: GET (default), POST, PUT, DELETE', required: false, default: 'GET' },
      { name: 'headers', type: 'object', description: 'Custom HTTP headers as key-value pairs', required: false },
      { name: 'body', type: 'string', description: 'Request body for POST/PUT (string or JSON string)', required: false },
      { name: 'selector', type: 'string', description: 'CSS selector to extract specific content', required: false },
      { name: 'extract', type: 'string', description: 'What to extract: "text" (default), "links", "images", "html", "tables", "metadata", "json"', required: false, default: 'text' },
      { name: 'maxLength', type: 'number', description: 'Max content length in characters', required: false, default: 10000 },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const url = String(params['url']);
    const method = (String(params['method'] || 'GET')).toUpperCase();
    const customHeaders = params['headers'] as Record<string, string> | undefined;
    const body = params['body'] as string | undefined;
    const selector = params['selector'] as string | undefined;
    const extract = (params['extract'] as string) || 'text';
    const maxLength = Math.min(Number(params['maxLength']) || 10000, MAX_CONTENT_LENGTH);

    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method)) {
      return { success: false, error: `Invalid HTTP method: ${method}`, duration: 0 };
    }

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
      const fetchHeaders: Record<string, string> = {
        'User-Agent': randomUA(),
        'Accept': extract === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...customHeaders,
      };

      if (body && !fetchHeaders['Content-Type']) {
        fetchHeaders['Content-Type'] = 'application/json';
      }

      // Retry logic: up to 2 retries with backoff
      const MAX_RETRIES = 2;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);

        try {
          if (attempt > 0) {
            // Rotate User-Agent on retry
            fetchHeaders['User-Agent'] = randomUA();
            await new Promise(r => setTimeout(r, 1000 * attempt));
            this.logger.debug('Retrying web browse', { url, attempt });
          }

          const response = await fetch(url, {
            method,
            signal: controller.signal,
            headers: fetchHeaders,
            body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
            redirect: 'follow',
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Success — process response below
          // (the rest of the original code continues from here)

        // JSON extraction — return parsed JSON directly
        if (extract === 'json') {
          const text = await response.text();
          try {
            const json = JSON.parse(text);
            const str = JSON.stringify(json, null, 2);
            return {
              type: 'json',
              status: response.status,
              data: str.length > maxLength ? JSON.parse(str.slice(0, maxLength)) : json,
              truncated: str.length > maxLength,
            };
          } catch {
            return { type: 'json', status: response.status, error: 'Response is not valid JSON', raw: text.slice(0, 500) };
          }
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

          case 'tables': {
            const tables: Array<{ headers: string[]; rows: string[][]; rowCount: number }> = [];
            root.find('table').each((_, table) => {
              if (tables.length >= 5) return;
              const headers: string[] = [];
              $(table).find('thead th, thead td, tr:first-child th').each((_, th) => {
                headers.push($(th).text().trim());
              });
              const rows: string[][] = [];
              const allRows = $(table).find('tbody tr, tr');
              const startIdx = headers.length > 0 ? 1 : 0;
              allRows.each((i, tr) => {
                if (i < startIdx || rows.length >= 100) return;
                const row: string[] = [];
                $(tr).find('td, th').each((_, td) => {
                  row.push($(td).text().trim().slice(0, 200));
                });
                if (row.length > 0) rows.push(row);
              });
              tables.push({ headers, rows, rowCount: rows.length });
            });
            return { type: 'tables', count: tables.length, tables };
          }

          case 'metadata': {
            const meta: Record<string, string> = {};
            $('meta').each((_, el) => {
              const name = $(el).attr('name') || $(el).attr('property') || '';
              const content = $(el).attr('content') || '';
              if (name && content) meta[name] = content.slice(0, 500);
            });
            return {
              type: 'metadata',
              title: $('title').text().trim(),
              description: meta['description'] || meta['og:description'] || '',
              ogTitle: meta['og:title'] || '',
              ogImage: meta['og:image'] || '',
              ogType: meta['og:type'] || '',
              canonical: $('link[rel="canonical"]').attr('href') || '',
              lang: $('html').attr('lang') || '',
              all: meta,
            };
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
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          clearTimeout(timeout);
          if (attempt < MAX_RETRIES) continue;
          throw lastError;
        } finally {
          clearTimeout(timeout);
        }
      }
      // Should never reach here, but just in case
      throw lastError ?? new Error('Unexpected error');
    });

    this.logger.debug('Web browse completed', { url, extract, duration });
    return { success: true, data: result, duration };
  }
}
