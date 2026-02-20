import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

// Local/private addresses are ALLOWED since the agent runs locally and needs to test local sites.
// Only block dangerous non-HTTP protocols in isBlockedUrl().
const BLOCKED_DOMAINS: string[] = [];

const SCREENSHOT_DIR = resolve(process.cwd(), '.forgeai', 'screenshots');
const MAX_NAV_TIMEOUT = 30_000;

const STEALTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class PuppeteerBrowserTool extends BaseTool {
  private browser: Browser | null = null;

  readonly definition: ToolDefinition = {
    name: 'browser',
    description: 'Full browser control via headless Chrome: navigate, screenshot, extract content/tables, click, type, scroll, hover, select dropdowns, go back/forward/reload, wait for elements, manage cookies, execute JS, export PDF. Supports multi-tab.',
    category: 'browser',
    parameters: [
      { name: 'action', type: 'string', description: 'Action: navigate|screenshot|content|click|type|scroll|hover|select|back|forward|reload|wait|cookies|set_cookie|clear_cookies|extract_table|evaluate|pdf|new_tab|switch_tab|close_tab|close', required: true },
      { name: 'url', type: 'string', description: 'URL for navigate action', required: false },
      { name: 'selector', type: 'string', description: 'CSS selector for click/type/hover/select/content/wait/extract_table', required: false },
      { name: 'text', type: 'string', description: 'Text for type action', required: false },
      { name: 'value', type: 'string', description: 'Value for select (dropdown) action', required: false },
      { name: 'script', type: 'string', description: 'JavaScript for evaluate action', required: false },
      { name: 'fullPage', type: 'boolean', description: 'Full-page screenshot (default: true)', required: false, default: true },
      { name: 'waitFor', type: 'string', description: 'CSS selector to wait for after navigation', required: false },
      { name: 'direction', type: 'string', description: 'Scroll direction: down|up|left|right|top|bottom (default: down)', required: false, default: 'down' },
      { name: 'amount', type: 'number', description: 'Scroll amount in pixels (default: 500)', required: false, default: 500 },
      { name: 'timeout', type: 'number', description: 'Wait timeout in ms (default: 10000)', required: false, default: 10000 },
      { name: 'cookie', type: 'object', description: 'Cookie object {name, value, domain, path} for set_cookie', required: false },
      { name: 'tabIndex', type: 'number', description: 'Tab index for switch_tab/close_tab', required: false },
    ],
  };

  private async ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
    if (!this.browser || !this.browser.connected) {
      try {
        this.browser = await puppeteer.launch({
          headless: 'shell',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-blink-features=AutomationControlled',
            `--user-agent=${STEALTH_UA}`,
            '--lang=pt-BR,pt,en-US,en',
          ],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Could not find Chrome') || msg.includes('Failed to launch') || msg.includes('ENOENT')) {
          throw new Error(
            'Chrome/Chromium is not installed. Run "npx puppeteer browsers install chrome" to install it, or use the web_browse tool (HTTP-only, no JS) as a fallback.'
          );
        }
        throw err;
      }
    }

    const pages = await this.browser.pages();
    const page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    // Stealth: override navigator.webdriver and other bot signals
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      // @ts-ignore
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({ query: (_p: any) => Promise.resolve({ state: 'granted', onchange: null }) }),
      });
    });

    await page.setUserAgent(STEALTH_UA);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setViewport({ width: 1280, height: 720 });
    return { browser: this.browser, page };
  }

  private isBlockedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return true;
      const hostname = parsed.hostname;
      return BLOCKED_DOMAINS.some(d => hostname === d || hostname.startsWith(d));
    } catch {
      return true;
    }
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const action = String(params['action'] || '');

    if (!action) {
      return { success: false, error: 'action is required', duration: 0 };
    }

    if (action === 'close') {
      return this.closeAction();
    }

    const { result, duration } = await this.timed(async () => {
      const { page } = await this.ensureBrowser();

      switch (action) {
        case 'navigate':
          return this.navigateAction(page, params);
        case 'screenshot':
          return this.screenshotAction(page, params);
        case 'content':
          return this.contentAction(page, params);
        case 'click':
          return this.clickAction(page, params);
        case 'type':
          return this.typeAction(page, params);
        case 'scroll':
          return this.scrollAction(page, params);
        case 'hover':
          return this.hoverAction(page, params);
        case 'select':
          return this.selectAction(page, params);
        case 'back':
          await page.goBack({ waitUntil: 'networkidle2', timeout: MAX_NAV_TIMEOUT });
          return { action: 'back', url: page.url(), title: await page.title() };
        case 'forward':
          await page.goForward({ waitUntil: 'networkidle2', timeout: MAX_NAV_TIMEOUT });
          return { action: 'forward', url: page.url(), title: await page.title() };
        case 'reload':
          await page.reload({ waitUntil: 'networkidle2', timeout: MAX_NAV_TIMEOUT });
          return { action: 'reload', url: page.url(), title: await page.title() };
        case 'wait':
          return this.waitAction(page, params);
        case 'cookies':
          return this.getCookiesAction(page);
        case 'set_cookie':
          return this.setCookieAction(page, params);
        case 'clear_cookies':
          return this.clearCookiesAction(page);
        case 'extract_table':
          return this.extractTableAction(page, params);
        case 'evaluate':
          return this.evaluateAction(page, params);
        case 'pdf':
          return this.pdfAction(page);
        case 'new_tab':
          return this.newTabAction(params);
        case 'switch_tab':
          return this.switchTabAction(params);
        case 'close_tab':
          return this.closeTabAction(params);
        default:
          throw new Error(`Unknown action: ${action}. Valid: navigate, screenshot, content, click, type, scroll, hover, select, back, forward, reload, wait, cookies, set_cookie, clear_cookies, extract_table, evaluate, pdf, new_tab, switch_tab, close_tab, close`);
      }
    });

    this.logger.debug('Browser action completed', { action, duration });
    return { success: true, data: result, duration };
  }

  private async navigateAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = String(params['url'] || '');
    if (!url) throw new Error('url is required for navigate action');
    if (this.isBlockedUrl(url)) throw new Error('Access to private/local addresses is blocked');

    const waitFor = params['waitFor'] as string | undefined;

    // Retry navigation up to 2 times (HTTP2 errors, timeouts, etc.)
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.debug('Retrying navigation', { url, attempt });
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
        await page.goto(url, {
          waitUntil: attempt > 0 ? 'domcontentloaded' : 'networkidle2',
          timeout: MAX_NAV_TIMEOUT,
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= MAX_RETRIES) throw lastError;
      }
    }

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10_000 });
    }

    const title = await page.title();
    const currentUrl = page.url();

    return { title, url: currentUrl, status: 'navigated' };
  }

  private async screenshotAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fullPage = params['fullPage'] !== false;

    if (!existsSync(SCREENSHOT_DIR)) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const filename = `screenshot_${Date.now()}.png`;
    const filepath = resolve(SCREENSHOT_DIR, filename);

    await page.screenshot({
      path: filepath,
      fullPage,
      type: 'png',
    });

    const title = await page.title();

    return {
      path: filepath,
      filename,
      imageUrl: `/api/files/screenshots/${filename}`,
      title,
      url: page.url(),
      fullPage,
    };
  }

  private async contentAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = params['selector'] as string | undefined;

    if (selector) {
      const elements = await page.$$eval(selector, (els: any[]) =>
        els.map((el: any) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 500),
          href: el.href || undefined,
        }))
      );
      return { selector, count: elements.length, elements: elements.slice(0, 50) };
    }

    const title = await page.title();
    const text = await page.evaluate(`
      (() => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
      })()
    `) as string;

    return {
      title,
      url: page.url(),
      content: text.slice(0, 15_000),
      length: text.length,
      truncated: text.length > 15_000,
    };
  }

  private async clickAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = String(params['selector'] || '');
    if (!selector) throw new Error('selector is required for click action');

    await page.waitForSelector(selector, { timeout: 5_000 });
    await page.click(selector);

    // Wait briefly for any navigation or DOM changes
    await new Promise(r => setTimeout(r, 500));

    return { clicked: selector, url: page.url(), title: await page.title() };
  }

  private async typeAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = String(params['selector'] || '');
    const text = String(params['text'] || '');
    if (!selector) throw new Error('selector is required for type action');
    if (!text) throw new Error('text is required for type action');

    await page.waitForSelector(selector, { timeout: 5_000 });
    await page.click(selector, { count: 3 }); // Select all existing text
    await page.type(selector, text, { delay: 30 });

    return { typed: text, selector, url: page.url() };
  }

  private async evaluateAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const script = String(params['script'] || '');
    if (!script) throw new Error('script is required for evaluate action');

    // Security: block dangerous patterns
    const dangerous = ['require(', 'process.', 'child_process', '__dirname', '__filename', 'import('];
    for (const pattern of dangerous) {
      if (script.includes(pattern)) {
        throw new Error(`Blocked: script contains dangerous pattern "${pattern}"`);
      }
    }

    const result = await page.evaluate(script);
    return { result: result !== undefined ? String(result).slice(0, 10_000) : null };
  }

  private async pdfAction(page: Page): Promise<Record<string, unknown>> {
    if (!existsSync(SCREENSHOT_DIR)) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const filename = `page_${Date.now()}.pdf`;
    const filepath = resolve(SCREENSHOT_DIR, filename);

    await page.pdf({ path: filepath, format: 'A4', printBackground: true });

    return { path: filepath, filename, url: page.url(), title: await page.title() };
  }

  // ─── New Actions ─────────────────────────────────────

  private async scrollAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const direction = String(params['direction'] || 'down');
    const amount = Number(params['amount']) || 500;

    switch (direction) {
      case 'top':
        await page.evaluate('window.scrollTo(0, 0)');
        break;
      case 'bottom':
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        break;
      case 'up':
        await page.evaluate(`window.scrollBy(0, -${amount})`);
        break;
      case 'down':
        await page.evaluate(`window.scrollBy(0, ${amount})`);
        break;
      case 'left':
        await page.evaluate(`window.scrollBy(-${amount}, 0)`);
        break;
      case 'right':
        await page.evaluate(`window.scrollBy(${amount}, 0)`);
        break;
      default:
        throw new Error(`Invalid direction: ${direction}. Use: down, up, left, right, top, bottom`);
    }

    const scrollPos = await page.evaluate('({ x: window.scrollX, y: window.scrollY, maxY: document.body.scrollHeight - window.innerHeight })') as { x: number; y: number; maxY: number };
    return { scrolled: direction, amount, ...scrollPos };
  }

  private async hoverAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = String(params['selector'] || '');
    if (!selector) throw new Error('selector is required for hover action');

    await page.waitForSelector(selector, { timeout: 5_000 });
    await page.hover(selector);
    await new Promise(r => setTimeout(r, 300));

    return { hovered: selector, url: page.url() };
  }

  private async selectAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = String(params['selector'] || '');
    const value = String(params['value'] || '');
    if (!selector) throw new Error('selector is required for select action');
    if (!value) throw new Error('value is required for select action');

    await page.waitForSelector(selector, { timeout: 5_000 });
    const selected = await page.select(selector, value);

    return { selector, selected, url: page.url() };
  }

  private async waitAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = params['selector'] as string | undefined;
    const timeout = Number(params['timeout']) || 10_000;

    if (selector) {
      await page.waitForSelector(selector, { timeout });
      return { waited: 'selector', selector, found: true };
    }

    // Wait for a fixed time
    const ms = Math.min(timeout, 30_000);
    await new Promise(r => setTimeout(r, ms));
    return { waited: 'time', ms };
  }

  private async getCookiesAction(page: Page): Promise<Record<string, unknown>> {
    const cookies = await page.cookies();
    return {
      count: cookies.length,
      cookies: cookies.map(c => ({ name: c.name, value: c.value.slice(0, 100), domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure })),
    };
  }

  private async setCookieAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cookie = params['cookie'] as { name?: string; value?: string; domain?: string; path?: string } | undefined;
    if (!cookie || !cookie.name || !cookie.value) throw new Error('cookie with name and value is required');

    await page.setCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || new URL(page.url()).hostname,
      path: cookie.path || '/',
    });

    return { set: cookie.name, domain: cookie.domain || new URL(page.url()).hostname };
  }

  private async clearCookiesAction(page: Page): Promise<Record<string, unknown>> {
    const cookies = await page.cookies();
    if (cookies.length > 0) {
      await page.deleteCookie(...cookies);
    }
    return { cleared: cookies.length };
  }

  private async extractTableAction(page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const selector = (params['selector'] as string) || 'table';

    await page.waitForSelector(selector, { timeout: 5_000 });

    const tables = await page.$$eval(selector, (tables: any[]) => {
      return tables.slice(0, 5).map((table: any) => {
        const headers: string[] = [];
        table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td').forEach((th: any) => {
          headers.push((th.textContent || '').trim());
        });

        const rows: string[][] = [];
        const bodyRows = table.querySelectorAll('tbody tr, tr');
        const startIdx = headers.length > 0 ? 1 : 0;
        for (let i = startIdx; i < Math.min(bodyRows.length, 100); i++) {
          const row: string[] = [];
          bodyRows[i].querySelectorAll('td, th').forEach((td: any) => {
            row.push((td.textContent || '').trim().slice(0, 200));
          });
          if (row.length > 0) rows.push(row);
        }

        return { headers, rows, rowCount: rows.length };
      });
    });

    return { selector, tables, tableCount: tables.length };
  }

  // ─── Tab Management ─────────────────────────────────────

  private async newTabAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.browser) throw new Error('Browser not open');
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const url = params['url'] as string | undefined;
    if (url) {
      if (this.isBlockedUrl(url)) throw new Error('Blocked URL');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: MAX_NAV_TIMEOUT });
    }

    const pages = await this.browser.pages();
    return { tabIndex: pages.length - 1, totalTabs: pages.length, url: page.url(), title: await page.title() };
  }

  private async switchTabAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.browser) throw new Error('Browser not open');
    const pages = await this.browser.pages();
    const idx = Number(params['tabIndex'] ?? 0);
    if (idx < 0 || idx >= pages.length) throw new Error(`Tab index ${idx} out of range (0-${pages.length - 1})`);

    await pages[idx].bringToFront();
    return { tabIndex: idx, totalTabs: pages.length, url: pages[idx].url(), title: await pages[idx].title() };
  }

  private async closeTabAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.browser) throw new Error('Browser not open');
    const pages = await this.browser.pages();
    const idx = Number(params['tabIndex'] ?? pages.length - 1);
    if (idx < 0 || idx >= pages.length) throw new Error(`Tab index ${idx} out of range`);
    if (pages.length <= 1) throw new Error('Cannot close the last tab. Use close action instead.');

    await pages[idx].close();
    const remaining = await this.browser.pages();
    return { closed: idx, totalTabs: remaining.length };
  }

  private async closeAction(): Promise<ToolResult> {
    const start = Date.now();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    return { success: true, data: { status: 'browser closed' }, duration: Date.now() - start };
  }
}
