import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:GeoIP');

export interface GeoIPResult {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  isp: string;
  org: string;
  lat: number;
  lon: number;
  timezone: string;
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60_000; // 24h
const API_URL = 'http://ip-api.com/json';
const RATE_LIMIT_MS = 1500; // ip-api.com allows 45 req/min ≈ 1 req/1.3s

export class IPGeolocationService {
  private cache: Map<string, { data: GeoIPResult; cachedAt: number }> = new Map();
  private lastRequestAt = 0;
  private queue: Array<{ ip: string; resolve: (v: GeoIPResult | null) => void }> = [];
  private processing = false;

  /**
   * Lookup geolocation for an IP address.
   * Uses in-memory cache (24h TTL) and rate-limited API calls.
   */
  async lookup(ip: string): Promise<GeoIPResult | null> {
    // Check cache first
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return { ...cached.data, cached: true };
    }

    // Skip private/local IPs
    if (this.isPrivate(ip)) {
      return { ip, country: 'Local', countryCode: 'LO', region: '', city: 'Localhost', isp: 'Private', org: 'Private Network', lat: 0, lon: 0, timezone: '', cached: false };
    }

    return new Promise((resolve) => {
      this.queue.push({ ip, resolve });
      this.processQueue();
    });
  }

  /**
   * Batch lookup multiple IPs. Returns a map of IP → GeoIPResult.
   */
  async lookupBatch(ips: string[]): Promise<Map<string, GeoIPResult>> {
    const unique = [...new Set(ips)];
    const results = new Map<string, GeoIPResult>();

    const promises = unique.map(async (ip) => {
      const result = await this.lookup(ip);
      if (result) results.set(ip, result);
    });

    await Promise.all(promises);
    return results;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
    logger.info('GeoIP cache cleared');
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Check cache again (might have been populated by a previous request)
      const cached = this.cache.get(item.ip);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        item.resolve({ ...cached.data, cached: true });
        continue;
      }

      // Rate limit
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < RATE_LIMIT_MS) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
      }

      try {
        this.lastRequestAt = Date.now();
        const response = await fetch(`${API_URL}/${item.ip}?fields=status,country,countryCode,regionName,city,isp,org,lat,lon,timezone`);
        const data = await response.json() as Record<string, unknown>;

        if (data['status'] === 'success') {
          const result: GeoIPResult = {
            ip: item.ip,
            country: (data['country'] as string) || 'Unknown',
            countryCode: (data['countryCode'] as string) || '??',
            region: (data['regionName'] as string) || '',
            city: (data['city'] as string) || '',
            isp: (data['isp'] as string) || '',
            org: (data['org'] as string) || '',
            lat: (data['lat'] as number) || 0,
            lon: (data['lon'] as number) || 0,
            timezone: (data['timezone'] as string) || '',
            cached: false,
          };
          this.cache.set(item.ip, { data: result, cachedAt: Date.now() });
          item.resolve(result);
        } else {
          logger.debug('GeoIP lookup failed', { ip: item.ip, status: data['status'] });
          item.resolve(null);
        }
      } catch (err) {
        logger.error('GeoIP API error', { ip: item.ip, error: String(err) });
        item.resolve(null);
      }
    }

    this.processing = false;
  }

  private isPrivate(ip: string): boolean {
    return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|fc00:|fe80:|0\.0\.0\.0|localhost)/i.test(ip);
  }
}

export function createIPGeolocationService(): IPGeolocationService {
  return new IPGeolocationService();
}
