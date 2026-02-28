// ─── Cloudflare Bypass ─────────────────────────────────────
// Built-in Cloudflare challenge detection, cookie caching, and
// Puppeteer-based solver. Allows the lightweight web_browse (Cheerio)
// tool to transparently access CF-protected sites by reusing cached
// cf_clearance cookies, falling back to a headless browser solve
// only when needed.

import { createLogger } from '@forgeai/shared';

const logger = createLogger('CFBypass');

// ─── Types ──────────────────────────────────────────────────

export interface CFCookie {
  /** The cf_clearance cookie value */
  cfClearance: string;
  /** The User-Agent that was used when solving the challenge */
  userAgent: string;
  /** Domain the cookie belongs to */
  domain: string;
  /** When this entry was cached (epoch ms) */
  cachedAt: number;
  /** Cookie expiry (epoch ms) — cf_clearance typically lasts 30 min */
  expiresAt: number;
  /** Any additional cookies needed alongside cf_clearance */
  extraCookies: Record<string, string>;
}

// ─── Detection ──────────────────────────────────────────────

/** HTML patterns that indicate a Cloudflare JS challenge page */
const CF_HTML_PATTERNS = [
  'cf-browser-verification',
  '_cf_chl_opt',
  'cf_chl_prog',
  'cf-challenge-running',
  'Checking your browser',
  'Checking if the site connection is secure',
  'Enable JavaScript and cookies to continue',
  'Just a moment...',
  'Aguarde...',
  'Verify you are human',
  'challenges.cloudflare.com',
  'cdn-cgi/challenge-platform',
  'ray ID',
];

/** Response header patterns from Cloudflare */
const CF_HEADER_PATTERNS = [
  'cf-ray',
  'cf-mitigated',
  'cf-chl-bypass',
];

/**
 * Detect whether an HTTP response is a Cloudflare challenge page.
 * Works with raw HTML + response headers/status.
 */
export function isCloudflareChallenge(
  html: string,
  status: number,
  headers?: Record<string, string>,
): boolean {
  // Cloudflare challenges typically return 403 or 503
  const isCFStatus = status === 403 || status === 503;

  // Check response headers for CF signatures
  let hasCFHeaders = false;
  if (headers) {
    const lowerHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    hasCFHeaders = CF_HEADER_PATTERNS.some(p => p in lowerHeaders);
    // cf-mitigated: challenge means CF actively blocking
    if (lowerHeaders['cf-mitigated'] === 'challenge') return true;
  }

  // Check HTML body for CF challenge markers
  const lowerHtml = html.toLowerCase();
  const matchCount = CF_HTML_PATTERNS.filter(p => lowerHtml.includes(p.toLowerCase())).length;

  // High confidence: CF status + CF headers + any HTML pattern
  if (isCFStatus && hasCFHeaders && matchCount >= 1) return true;

  // High confidence: multiple HTML patterns (even without headers)
  if (matchCount >= 2) return true;

  // Medium confidence: CF status + strong HTML pattern
  if (isCFStatus && matchCount >= 1) return true;

  return false;
}

/**
 * Quick check on a fetch Response object.
 * Reads headers and a small portion of the body.
 */
export function isCloudflareResponse(
  status: number,
  headerEntries: [string, string][],
  bodySnippet: string,
): boolean {
  const headers = Object.fromEntries(headerEntries);
  return isCloudflareChallenge(bodySnippet, status, headers);
}

// ─── Cookie Cache ───────────────────────────────────────────

/** Default TTL: 25 minutes (cf_clearance usually lasts ~30 min) */
const DEFAULT_TTL_MS = 25 * 60 * 1000;

/** Maximum cache size to prevent unbounded growth */
const MAX_CACHE_SIZE = 200;

/**
 * In-memory cache of CF bypass cookies, keyed by domain.
 * Thread-safe for single-process Node.js.
 */
class CFCookieCache {
  private cache = new Map<string, CFCookie>();

  /** Get a valid (non-expired) cached cookie for a domain */
  get(domain: string): CFCookie | null {
    const entry = this.cache.get(domain);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(domain);
      return null;
    }
    return entry;
  }

  /** Store a CF bypass cookie for a domain */
  set(domain: string, cookie: CFCookie): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(domain, cookie);
  }

  /** Invalidate a specific domain */
  invalidate(domain: string): void {
    this.cache.delete(domain);
  }

  /** Clear the entire cache */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached entries */
  get size(): number {
    return this.cache.size;
  }

  /** Get stats for debugging */
  stats(): { size: number; domains: string[] } {
    // Prune expired on stats call
    const now = Date.now();
    for (const [domain, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(domain);
    }
    return {
      size: this.cache.size,
      domains: [...this.cache.keys()],
    };
  }
}

// Singleton cache instance
const cookieCache = new CFCookieCache();

export function getCFCookieCache(): CFCookieCache {
  return cookieCache;
}

// ─── Solver (Puppeteer) ─────────────────────────────────────

/**
 * Solve a Cloudflare challenge using Puppeteer.
 * Navigates to the URL with stealth evasions, waits for the challenge
 * to resolve, then extracts the cf_clearance cookie.
 *
 * @param url - The URL behind Cloudflare protection
 * @param launchBrowser - Function that launches a stealth Puppeteer browser
 * @returns The extracted CF cookie or null if solving failed
 */
export async function solveCFChallenge(
  url: string,
  launchBrowser: () => Promise<{
    browser: import('puppeteer').Browser;
    page: import('puppeteer').Page;
    userAgent: string;
    closeBrowser: () => Promise<void>;
  }>,
): Promise<CFCookie | null> {
  const startTime = Date.now();
  let browserCtx: Awaited<ReturnType<typeof launchBrowser>> | null = null;

  try {
    const domain = new URL(url).hostname;
    logger.info('Solving Cloudflare challenge', { url, domain });

    browserCtx = await launchBrowser();
    const { page, userAgent } = browserCtx;

    // Navigate to the CF-protected page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Wait for the challenge to resolve — CF typically redirects or
    // updates the page within 5-15 seconds after the JS challenge runs.
    // We poll for cf_clearance cookie appearance.
    const maxWait = 30_000;
    const pollInterval = 1_000;
    let elapsed = 0;
    let solved = false;

    while (elapsed < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));
      elapsed += pollInterval;

      // Check if cf_clearance cookie appeared
      const cookies = await page.cookies();
      const clearanceCookie = cookies.find(c => c.name === 'cf_clearance');

      if (clearanceCookie) {
        solved = true;

        // Collect all cookies for this domain (some sites need multiple)
        const extraCookies: Record<string, string> = {};
        for (const c of cookies) {
          if (c.name !== 'cf_clearance' && c.domain.includes(domain)) {
            extraCookies[c.name] = c.value;
          }
        }

        const cfCookie: CFCookie = {
          cfClearance: clearanceCookie.value,
          userAgent,
          domain,
          cachedAt: Date.now(),
          expiresAt: Date.now() + DEFAULT_TTL_MS,
          extraCookies,
        };

        // Cache it
        cookieCache.set(domain, cfCookie);

        const solveTime = Date.now() - startTime;
        logger.info('Cloudflare challenge solved', {
          domain,
          solveTimeMs: solveTime,
          extraCookies: Object.keys(extraCookies).length,
        });

        return cfCookie;
      }

      // Check if page has moved past the challenge (no more challenge HTML)
      const pageContent = await page.content();
      const stillChallenge = CF_HTML_PATTERNS.some(p =>
        pageContent.toLowerCase().includes(p.toLowerCase()),
      );

      if (!stillChallenge && elapsed > 3_000) {
        // Page loaded real content but no cf_clearance — might be Turnstile
        // or the challenge resolved via other means. Check cookies one more time.
        const finalCookies = await page.cookies();
        const finalClearance = finalCookies.find(c => c.name === 'cf_clearance');
        if (finalClearance) {
          const extraCookies: Record<string, string> = {};
          for (const c of finalCookies) {
            if (c.name !== 'cf_clearance' && c.domain.includes(domain)) {
              extraCookies[c.name] = c.value;
            }
          }
          const cfCookie: CFCookie = {
            cfClearance: finalClearance.value,
            userAgent,
            domain,
            cachedAt: Date.now(),
            expiresAt: Date.now() + DEFAULT_TTL_MS,
            extraCookies,
          };
          cookieCache.set(domain, cfCookie);
          logger.info('Cloudflare challenge resolved (no cookie wait needed)', { domain });
          return cfCookie;
        }

        // Page loaded but no cf_clearance — might not be CF or Turnstile needs interaction
        logger.debug('Challenge page cleared but no cf_clearance cookie found', { domain, elapsed });
        break;
      }
    }

    if (!solved) {
      logger.warn('Cloudflare challenge solve timed out', {
        domain,
        elapsed,
        maxWait,
      });
    }

    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Cloudflare challenge solve failed', { url, error: msg });
    return null;
  } finally {
    if (browserCtx) {
      try { await browserCtx.closeBrowser(); } catch { /* ignore */ }
    }
  }
}

// ─── Fetch with CF Bypass ───────────────────────────────────

/**
 * Build fetch headers that include cached CF cookies for a domain.
 * Returns null if no cached cookie is available.
 */
export function buildCFHeaders(
  url: string,
): { cookie: string; userAgent: string } | null {
  try {
    const domain = new URL(url).hostname;
    const cached = cookieCache.get(domain);
    if (!cached) return null;

    // Build cookie header
    const cookieParts = [`cf_clearance=${cached.cfClearance}`];
    for (const [name, value] of Object.entries(cached.extraCookies)) {
      cookieParts.push(`${name}=${value}`);
    }

    return {
      cookie: cookieParts.join('; '),
      userAgent: cached.userAgent,
    };
  } catch {
    return null;
  }
}

/**
 * Extract domain from URL for cache lookups.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
