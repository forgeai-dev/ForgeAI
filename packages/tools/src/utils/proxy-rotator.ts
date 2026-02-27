// ─── Proxy Rotator ─────────────────────────────────────
// Thread-safe proxy rotation with pluggable strategies.
// Inspired by Scrapling's ProxyRotator but adapted for Node.js/TypeScript.

export interface ProxyConfig {
  url: string;
  username?: string;
  password?: string;
}

export type RotationStrategy = 'cyclic' | 'random' | 'failover';

const PROXY_ERROR_PATTERNS = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'proxy',
  'Proxy',
  '407',
  '502',
  '503',
  'tunnel',
  'SOCKS',
];

export function isProxyError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return PROXY_ERROR_PATTERNS.some(p => msg.includes(p));
}

export function parseProxyUrl(input: string): ProxyConfig {
  // Supports formats:
  //   http://user:pass@host:port
  //   socks5://host:port
  //   host:port
  //   host:port:user:pass
  if (input.includes('://')) {
    try {
      const parsed = new URL(input);
      return {
        url: `${parsed.protocol}//${parsed.hostname}:${parsed.port || '8080'}`,
        username: parsed.username || undefined,
        password: parsed.password || undefined,
      };
    } catch {
      return { url: input };
    }
  }

  const parts = input.split(':');
  if (parts.length === 4) {
    // host:port:user:pass
    return {
      url: `http://${parts[0]}:${parts[1]}`,
      username: parts[2],
      password: parts[3],
    };
  }
  if (parts.length === 2) {
    return { url: `http://${parts[0]}:${parts[1]}` };
  }
  return { url: input.startsWith('http') ? input : `http://${input}` };
}

export class ProxyRotator {
  private proxies: ProxyConfig[];
  private strategy: RotationStrategy;
  private currentIndex: number = 0;
  private failedProxies: Set<string> = new Set();
  private failCounts: Map<string, number> = new Map();
  private maxFailures: number;

  constructor(
    proxies: (string | ProxyConfig)[],
    strategy: RotationStrategy = 'cyclic',
    maxFailures: number = 3,
  ) {
    this.proxies = proxies.map(p => typeof p === 'string' ? parseProxyUrl(p) : p);
    this.strategy = strategy;
    this.maxFailures = maxFailures;

    if (this.proxies.length === 0) {
      throw new Error('ProxyRotator requires at least one proxy');
    }
  }

  get count(): number {
    return this.proxies.length;
  }

  get activeCount(): number {
    return this.proxies.filter(p => !this.failedProxies.has(p.url)).length;
  }

  next(): ProxyConfig | null {
    const available = this.proxies.filter(p => !this.failedProxies.has(p.url));
    if (available.length === 0) {
      // All proxies failed — reset and try again
      this.resetFailures();
      return this.proxies[0] || null;
    }

    switch (this.strategy) {
      case 'cyclic': {
        // Round-robin through available proxies
        const proxy = available[this.currentIndex % available.length];
        this.currentIndex = (this.currentIndex + 1) % available.length;
        return proxy;
      }
      case 'random': {
        return available[Math.floor(Math.random() * available.length)];
      }
      case 'failover': {
        // Always use first available; only move to next on failure
        return available[0];
      }
      default:
        return available[0];
    }
  }

  reportFailure(proxy: ProxyConfig): void {
    const count = (this.failCounts.get(proxy.url) || 0) + 1;
    this.failCounts.set(proxy.url, count);

    if (count >= this.maxFailures) {
      this.failedProxies.add(proxy.url);
    }
  }

  reportSuccess(proxy: ProxyConfig): void {
    this.failCounts.delete(proxy.url);
    this.failedProxies.delete(proxy.url);
  }

  resetFailures(): void {
    this.failedProxies.clear();
    this.failCounts.clear();
    this.currentIndex = 0;
  }

  // Get proxy URL with auth embedded (for HTTP clients)
  getProxyUrlWithAuth(proxy: ProxyConfig): string {
    if (!proxy.username || !proxy.password) return proxy.url;
    try {
      const parsed = new URL(proxy.url);
      parsed.username = proxy.username;
      parsed.password = proxy.password;
      return parsed.toString();
    } catch {
      return proxy.url;
    }
  }

  // Get proxy config for Puppeteer (just the server URL; auth handled separately)
  getPuppeteerProxy(proxy: ProxyConfig): { server: string; username?: string; password?: string } {
    return {
      server: proxy.url,
      username: proxy.username,
      password: proxy.password,
    };
  }

  // Get fetch-compatible proxy agent URL
  getFetchProxy(proxy: ProxyConfig): string {
    return this.getProxyUrlWithAuth(proxy);
  }

  toJSON(): { proxies: number; active: number; strategy: string; failed: string[] } {
    return {
      proxies: this.proxies.length,
      active: this.activeCount,
      strategy: this.strategy,
      failed: Array.from(this.failedProxies),
    };
  }
}

// Singleton instance — configured via settings
let globalRotator: ProxyRotator | null = null;

export function setGlobalProxyRotator(rotator: ProxyRotator | null): void {
  globalRotator = rotator;
}

export function getGlobalProxyRotator(): ProxyRotator | null {
  return globalRotator;
}

export function configureProxies(
  proxies: string[],
  strategy: RotationStrategy = 'cyclic',
  maxFailures: number = 3,
): ProxyRotator | null {
  if (!proxies || proxies.length === 0) {
    globalRotator = null;
    return null;
  }
  globalRotator = new ProxyRotator(proxies, strategy, maxFailures);
  return globalRotator;
}
