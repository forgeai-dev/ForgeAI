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

export class PuppeteerBrowserTool extends BaseTool {
  private browser: Browser | null = null;

  readonly definition: ToolDefinition = {
    name: 'browser',
    description: 'Advanced browser control: navigate to URLs, take screenshots, extract content, click elements, fill forms, and execute JavaScript. Uses a real headless Chrome instance.',
    category: 'browser',
    parameters: [
      { name: 'action', type: 'string', description: 'Action: "navigate", "screenshot", "content", "click", "type", "evaluate", "pdf", "close"', required: true },
      { name: 'url', type: 'string', description: 'URL to navigate to (for "navigate" action)', required: false },
      { name: 'selector', type: 'string', description: 'CSS selector for click/type/content actions', required: false },
      { name: 'text', type: 'string', description: 'Text to type (for "type" action)', required: false },
      { name: 'script', type: 'string', description: 'JavaScript to evaluate in page context (for "evaluate" action)', required: false },
      { name: 'fullPage', type: 'boolean', description: 'Take full-page screenshot (default: true)', required: false, default: true },
      { name: 'waitFor', type: 'string', description: 'CSS selector to wait for after navigation', required: false },
    ],
  };

  private async ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
    if (!this.browser || !this.browser.connected) {
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
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
        case 'evaluate':
          return this.evaluateAction(page, params);
        case 'pdf':
          return this.pdfAction(page);
        default:
          throw new Error(`Unknown action: ${action}. Valid: navigate, screenshot, content, click, type, evaluate, pdf, close`);
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

    await page.goto(url, { waitUntil: 'networkidle2', timeout: MAX_NAV_TIMEOUT });

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

  private async closeAction(): Promise<ToolResult> {
    const start = Date.now();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    return { success: true, data: { status: 'browser closed' }, duration: Date.now() - start };
  }
}
