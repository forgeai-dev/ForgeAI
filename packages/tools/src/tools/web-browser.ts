import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { getGlobalProxyRotator, isProxyError } from '../utils/proxy-rotator.js';
import {
  createFingerprint,
  findBestMatch,
  extractCandidateFromCheerio,
  extractAllCandidatesFromCheerio,
  type ElementFingerprint,
} from '../utils/element-fingerprint.js';
import {
  isCloudflareChallenge,
  buildCFHeaders,
  solveCFChallenge,
  getCFCookieCache,
  extractDomain,
} from '../utils/cf-bypass.js';

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
  // Adaptive element tracking: in-memory fingerprint cache (url::selector → fingerprint)
  private fingerprintCache: Map<string, ElementFingerprint> = new Map();
  // Track domains where CF bypass has already been attempted (avoid infinite loops)
  private cfBypassAttempted: Set<string> = new Set();

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
      { name: 'extract', type: 'string', description: 'What to extract: "text" (default), "markdown", "links", "images", "html", "tables", "metadata", "json". Markdown mode converts page content to clean Markdown, ideal for AI consumption with minimal tokens.', required: false, default: 'text' },
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
      // Check for cached CF bypass cookies before building headers
      const cfCached = buildCFHeaders(url);

      const fetchHeaders: Record<string, string> = {
        'User-Agent': cfCached?.userAgent || randomUA(),
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

      // Inject cached CF cookies if available
      if (cfCached) {
        fetchHeaders['Cookie'] = cfCached.cookie;
        this.logger.debug('Using cached CF bypass cookies', { url, domain: extractDomain(url) });
      }

      if (body && !fetchHeaders['Content-Type']) {
        fetchHeaders['Content-Type'] = 'application/json';
      }

      // Set referer as if coming from Google search (anti-bot evasion)
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        fetchHeaders['Referer'] = `https://www.google.com/search?q=${encodeURIComponent(domain)}`;
      } catch { /* ignore */ }

      // Retry logic: up to 2 retries with backoff
      const MAX_RETRIES = 2;
      let lastError: Error | null = null;
      const proxyRotator = getGlobalProxyRotator();

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

          const fetchOptions: RequestInit = {
            method,
            signal: controller.signal,
            headers: fetchHeaders,
            body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
            redirect: 'follow',
          };

          const response = await fetch(url, fetchOptions);

          // ─── Cloudflare Challenge Detection ─────────────────────
          // Check if the response is a CF challenge BEFORE checking response.ok,
          // since CF challenges return 403/503 which would throw.
          const responseStatus = response.status;
          const responseHeaders: [string, string][] = [];
          response.headers.forEach((v, k) => responseHeaders.push([k, v]));

          if (responseStatus === 403 || responseStatus === 503) {
            // Read body to check for CF challenge
            const bodyForCheck = await response.clone().text();
            const headersObj = Object.fromEntries(responseHeaders);

            if (isCloudflareChallenge(bodyForCheck, responseStatus, headersObj)) {
              const domain = extractDomain(url);

              // Invalidate any stale cached cookie for this domain
              getCFCookieCache().invalidate(domain);

              if (!this.cfBypassAttempted.has(domain)) {
                this.cfBypassAttempted.add(domain);
                this.logger.info('Cloudflare challenge detected, attempting bypass', { url, domain });

                // Attempt to solve via Puppeteer
                const solved = await this.solveCFWithPuppeteer(url);

                // Clean up the attempt tracker after a delay
                setTimeout(() => this.cfBypassAttempted.delete(domain), 60_000);

                if (solved) {
                  // Retry the fetch with the new CF cookies
                  const cfRetryHeaders = buildCFHeaders(url);
                  if (cfRetryHeaders) {
                    fetchHeaders['Cookie'] = cfRetryHeaders.cookie;
                    fetchHeaders['User-Agent'] = cfRetryHeaders.userAgent;

                    const retryController = new AbortController();
                    const retryTimeout = setTimeout(() => retryController.abort(), 25_000);
                    try {
                      const retryResponse = await fetch(url, {
                        ...fetchOptions,
                        signal: retryController.signal,
                        headers: fetchHeaders,
                      });

                      if (retryResponse.ok) {
                        // CF bypass successful! Continue with this response below.
                        clearTimeout(retryTimeout);
                        clearTimeout(timeout);
                        // Process the successful retry response
                        return await this.processResponse(retryResponse, url, extract, maxLength, selector, { cfBypassed: true });
                      }
                    } catch { /* retry failed, fall through */ }
                    finally { clearTimeout(retryTimeout); }
                  }
                }
              }

              // CF bypass failed or already attempted — return informative error
              throw new Error(
                `Cloudflare protection detected on ${domain}. ` +
                'Automatic bypass was attempted but could not resolve the challenge. ' +
                'Try using the browser tool (Puppeteer) to navigate this site directly.',
              );
            }
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Success — process response
          clearTimeout(timeout);
          return await this.processResponse(response, url, extract, maxLength, selector);

        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          // Report proxy failure if applicable
          if (proxyRotator && isProxyError(lastError)) {
            const proxy = proxyRotator.next();
            if (proxy) proxyRotator.reportFailure(proxy);
          }
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

  // ─── Response Processing ──────────────────────────────────────

  private async processResponse(
    response: Response,
    url: string,
    extract: string,
    maxLength: number,
    selector?: string,
    extra?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
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
          ...extra,
        };
      } catch {
        return { type: 'json', status: response.status, error: 'Response is not valid JSON', raw: text.slice(0, 500), ...extra };
      }
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts and styles
    $('script, style, noscript').remove();

    let resolvedSelector = selector;
    let adaptiveUsed = false;

    // Adaptive element tracking: if selector yields nothing, try fingerprint matching
    if (selector) {
      const selectorResult = $(selector);
      if (selectorResult.length === 0) {
        // Selector didn't match — try adaptive
        const cacheKey = `${url}::${selector}`;
        const fingerprint = this.fingerprintCache.get(cacheKey);
        if (fingerprint) {
          const candidates = extractAllCandidatesFromCheerio($, fingerprint.tag);
          const match = findBestMatch(fingerprint, candidates, 'medium');
          if (match) {
            resolvedSelector = match.candidate.generatedSelector;
            adaptiveUsed = true;
            this.logger.debug('Adaptive match in web_browse', {
              original: selector,
              resolved: resolvedSelector,
              score: match.score.toFixed(3),
              confidence: match.confidence,
            });
          }
        }
      } else {
        // Selector works — save fingerprint for future adaptive matching
        try {
          const firstEl = selectorResult.first();
          if (firstEl.length > 0) {
            const candidate = extractCandidateFromCheerio($, firstEl[0], selector);
            const fp = createFingerprint(url, selector, candidate);
            this.fingerprintCache.set(`${url}::${selector}`, fp);
          }
        } catch { /* non-critical */ }
      }
    }

    const root = resolvedSelector ? $(resolvedSelector) : $('body');
    const adaptiveInfo = adaptiveUsed ? { adaptiveMatch: true, originalSelector: selector, resolvedSelector } : {};
    const extraInfo = { ...adaptiveInfo, ...extra };

    switch (extract) {
      case 'links': {
        const links: Array<{ text: string; href: string }> = [];
        root.find('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          const text = $(el).text().trim();
          if (href && text) links.push({ text: text.slice(0, 200), href });
        });
        return { type: 'links', count: links.length, links: links.slice(0, 100), ...extraInfo };
      }

      case 'images': {
        const images: Array<{ alt: string; src: string }> = [];
        root.find('img[src]').each((_, el) => {
          const src = $(el).attr('src');
          const alt = $(el).attr('alt') || '';
          if (src) images.push({ alt, src });
        });
        return { type: 'images', count: images.length, images: images.slice(0, 50), ...extraInfo };
      }

      case 'html': {
        const content = root.html() || '';
        return { type: 'html', content: content.slice(0, maxLength), ...extraInfo };
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
        return { type: 'tables', count: tables.length, tables, ...extraInfo };
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
          ...extraInfo,
        };
      }

      case 'markdown': {
        const turndown = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        });
        // Remove noisy elements to reduce token usage
        turndown.addRule('removeNoise', {
          filter: (node: any) => ['IMG', 'IFRAME', 'SVG', 'VIDEO', 'AUDIO'].includes(node.nodeName),
          replacement: () => '',
        });
        const htmlContent = root.html() || '';
        const markdown = turndown.turndown(htmlContent)
          .replace(/\n{3,}/g, '\n\n')  // Collapse excessive newlines
          .trim();
        return {
          type: 'markdown',
          title: $('title').text().trim(),
          content: markdown.slice(0, maxLength),
          length: markdown.length,
          truncated: markdown.length > maxLength,
          ...extraInfo,
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
          ...extraInfo,
        };
      }
    }
  }

  // ─── Cloudflare Bypass via Puppeteer ──────────────────────────

  private async solveCFWithPuppeteer(url: string): Promise<boolean> {
    try {
      const result = await solveCFChallenge(url, async () => {
        // Dynamic import to avoid circular dependency — puppeteer is only
        // loaded when a CF challenge is actually detected.
        const puppeteer = await import('puppeteer');
        const { generateStealthProfile, getStealthLaunchArgs, applyStealthEvasions } = await import('../utils/browser-stealth.js');

        const profile = generateStealthProfile();
        const args = getStealthLaunchArgs(profile);

        const browser = await puppeteer.default.launch({
          headless: true,
          args,
        });

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        await applyStealthEvasions(page, profile);

        return {
          browser,
          page,
          userAgent: profile.userAgent,
          closeBrowser: async () => { try { await browser.close(); } catch { /* ignore */ } },
        };
      });

      return result !== null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('CF bypass Puppeteer solve failed', { url, error: msg });
      return false;
    }
  }
}
