import type { RateLimitConfig, RateLimitResult } from '@forgeai/shared';
import { createLogger, DEFAULT_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_MAX_REQUESTS } from '@forgeai/shared';

const logger = createLogger('Security:RateLimiter');

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      windowMs: config?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      maxRequests: config?.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
      keyPrefix: config?.keyPrefix ?? 'global',
    };

    // Cleanup expired buckets every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    logger.info('Rate limiter initialized', {
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests,
    });
  }

  check(key: string): RateLimitResult {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();

    let bucket = this.buckets.get(fullKey);

    // Reset bucket if window has passed
    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + this.config.windowMs,
      };
      this.buckets.set(fullKey, bucket);
    }

    bucket.count++;

    const allowed = bucket.count <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - bucket.count);
    const resetAt = new Date(bucket.resetAt);

    if (!allowed) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      logger.warn('Rate limit exceeded', { key: fullKey, count: bucket.count });
      return { allowed, remaining, resetAt, retryAfter };
    }

    return { allowed, remaining, resetAt };
  }

  consume(key: string): RateLimitResult {
    return this.check(key);
  }

  reset(key: string): void {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    this.buckets.delete(fullKey);
  }

  getStatus(key: string): { count: number; remaining: number; resetAt: Date } | null {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const bucket = this.buckets.get(fullKey);
    if (!bucket) return null;

    return {
      count: bucket.count,
      remaining: Math.max(0, this.config.maxRequests - bucket.count),
      resetAt: new Date(bucket.resetAt),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug('Rate limiter cleanup', { cleaned });
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }
}

export function createRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  return new RateLimiter(config);
}
