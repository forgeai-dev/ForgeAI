import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:AdvancedRateLimiter');

export interface RateLimitRule {
  key: string;
  windowMs: number;
  maxRequests: number;
  burstLimit?: number;
  burstWindowMs?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
  burstCount: number;
  burstResetAt: number;
}

export interface AdvancedRateLimitResult {
  allowed: boolean;
  remaining: number;
  burstRemaining: number;
  resetAt: Date;
  retryAfter?: number;
  rule: string;
}

const DEFAULT_RULES: RateLimitRule[] = [
  // Global per-IP
  { key: 'global', windowMs: 60_000, maxRequests: 120, burstLimit: 20, burstWindowMs: 5_000 },
  // Per-channel limits
  { key: 'channel:webchat', windowMs: 60_000, maxRequests: 60, burstLimit: 10, burstWindowMs: 5_000 },
  { key: 'channel:telegram', windowMs: 60_000, maxRequests: 30, burstLimit: 8, burstWindowMs: 5_000 },
  { key: 'channel:discord', windowMs: 60_000, maxRequests: 30, burstLimit: 8, burstWindowMs: 5_000 },
  { key: 'channel:whatsapp', windowMs: 60_000, maxRequests: 20, burstLimit: 5, burstWindowMs: 5_000 },
  { key: 'channel:slack', windowMs: 60_000, maxRequests: 30, burstLimit: 8, burstWindowMs: 5_000 },
  // Per-tool limits (dangerous tools get tighter limits)
  { key: 'tool:code_run', windowMs: 60_000, maxRequests: 10, burstLimit: 3, burstWindowMs: 10_000 },
  { key: 'tool:file_manager', windowMs: 60_000, maxRequests: 30, burstLimit: 5, burstWindowMs: 5_000 },
  { key: 'tool:web_browse', windowMs: 60_000, maxRequests: 20, burstLimit: 5, burstWindowMs: 5_000 },
  { key: 'tool:browser', windowMs: 60_000, maxRequests: 10, burstLimit: 3, burstWindowMs: 10_000 },
  { key: 'tool:cron_scheduler', windowMs: 60_000, maxRequests: 15, burstLimit: 5, burstWindowMs: 5_000 },
  { key: 'tool:knowledge_base', windowMs: 60_000, maxRequests: 40, burstLimit: 10, burstWindowMs: 5_000 },
];

export class AdvancedRateLimiter {
  private rules: Map<string, RateLimitRule> = new Map();
  private buckets: Map<string, Bucket> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(customRules?: RateLimitRule[]) {
    const rules = customRules ?? DEFAULT_RULES;
    for (const rule of rules) {
      this.rules.set(rule.key, rule);
    }

    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
    logger.info('Advanced rate limiter initialized', { ruleCount: this.rules.size });
  }

  consume(identifier: string, ruleKey: string): AdvancedRateLimitResult {
    const rule = this.rules.get(ruleKey);
    if (!rule) {
      // No rule = allow
      return { allowed: true, remaining: 999, burstRemaining: 999, resetAt: new Date(), rule: ruleKey };
    }

    const fullKey = `${ruleKey}:${identifier}`;
    const now = Date.now();

    let bucket = this.buckets.get(fullKey);
    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + rule.windowMs,
        burstCount: 0,
        burstResetAt: now + (rule.burstWindowMs ?? 5_000),
      };
      this.buckets.set(fullKey, bucket);
    }

    // Reset burst window if expired
    if (now >= bucket.burstResetAt) {
      bucket.burstCount = 0;
      bucket.burstResetAt = now + (rule.burstWindowMs ?? 5_000);
    }

    bucket.count++;
    bucket.burstCount++;

    const burstLimit = rule.burstLimit ?? rule.maxRequests;
    const burstExceeded = bucket.burstCount > burstLimit;
    const windowExceeded = bucket.count > rule.maxRequests;

    if (burstExceeded || windowExceeded) {
      const retryAfter = burstExceeded
        ? Math.ceil((bucket.burstResetAt - now) / 1000)
        : Math.ceil((bucket.resetAt - now) / 1000);

      logger.warn('Advanced rate limit exceeded', {
        key: fullKey,
        burst: burstExceeded,
        window: windowExceeded,
        count: bucket.count,
        burstCount: bucket.burstCount,
      });

      return {
        allowed: false,
        remaining: Math.max(0, rule.maxRequests - bucket.count),
        burstRemaining: Math.max(0, burstLimit - bucket.burstCount),
        resetAt: new Date(bucket.resetAt),
        retryAfter,
        rule: ruleKey,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, rule.maxRequests - bucket.count),
      burstRemaining: Math.max(0, burstLimit - bucket.burstCount),
      resetAt: new Date(bucket.resetAt),
      rule: ruleKey,
    };
  }

  consumeMulti(identifier: string, ruleKeys: string[]): AdvancedRateLimitResult {
    for (const ruleKey of ruleKeys) {
      const result = this.consume(identifier, ruleKey);
      if (!result.allowed) return result;
    }
    // Return the last (most permissive) result
    return this.consume(identifier, ruleKeys[ruleKeys.length - 1]);
  }

  addRule(rule: RateLimitRule): void {
    this.rules.set(rule.key, rule);
    logger.info('Rate limit rule added', { key: rule.key, max: rule.maxRequests });
  }

  removeRule(key: string): void {
    this.rules.delete(key);
  }

  getRules(): RateLimitRule[] {
    return Array.from(this.rules.values());
  }

  getStatus(identifier: string, ruleKey: string): { count: number; burstCount: number; remaining: number } | null {
    const fullKey = `${ruleKey}:${identifier}`;
    const bucket = this.buckets.get(fullKey);
    const rule = this.rules.get(ruleKey);
    if (!bucket || !rule) return null;
    return {
      count: bucket.count,
      burstCount: bucket.burstCount,
      remaining: Math.max(0, rule.maxRequests - bucket.count),
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
      logger.debug('Advanced rate limiter cleanup', { cleaned });
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

export function createAdvancedRateLimiter(rules?: RateLimitRule[]): AdvancedRateLimiter {
  return new AdvancedRateLimiter(rules);
}
