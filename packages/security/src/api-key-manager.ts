import { createLogger } from '@forgeai/shared';
import crypto from 'node:crypto';

const logger = createLogger('Security:APIKey');

export interface APIKey {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  usageCount: number;
  rateLimit?: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface APIKeyCreateResult {
  id: string;
  key: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt?: number;
}

export interface APIKeyValidation {
  valid: boolean;
  keyId?: string;
  scopes?: string[];
  error?: string;
}

const ALL_SCOPES = [
  'chat', 'tools', 'plugins', 'workflows', 'voice', 'webhooks',
  'sessions', 'backup', 'admin', 'mcp', 'memory', 'rag',
] as const;

export class APIKeyManager {
  private keys: Map<string, APIKey> = new Map();

  constructor() {
    logger.info('API Key manager initialized');
  }

  create(name: string, scopes: string[] = ['chat'], expiresInDays?: number, rateLimit?: number): APIKeyCreateResult {
    const id = crypto.randomUUID();
    const rawKey = `fai_${crypto.randomBytes(32).toString('base64url')}`;
    const prefix = rawKey.slice(0, 8);
    const keyHash = this.hashKey(rawKey);

    const apiKey: APIKey = {
      id,
      name,
      keyHash,
      prefix,
      scopes: scopes.filter(s => (ALL_SCOPES as readonly string[]).includes(s)),
      createdAt: Date.now(),
      expiresAt: expiresInDays ? Date.now() + expiresInDays * 86400000 : undefined,
      usageCount: 0,
      rateLimit,
      enabled: true,
    };

    this.keys.set(id, apiKey);
    logger.info('API key created', { id, name, scopes: apiKey.scopes, prefix });

    return {
      id,
      key: rawKey,
      prefix,
      name,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
    };
  }

  validate(rawKey: string, requiredScope?: string): APIKeyValidation {
    const keyHash = this.hashKey(rawKey);

    for (const apiKey of this.keys.values()) {
      if (apiKey.keyHash === keyHash) {
        if (!apiKey.enabled) {
          return { valid: false, error: 'API key is disabled' };
        }
        if (apiKey.expiresAt && Date.now() > apiKey.expiresAt) {
          return { valid: false, error: 'API key has expired' };
        }
        if (requiredScope && !apiKey.scopes.includes(requiredScope) && !apiKey.scopes.includes('admin')) {
          return { valid: false, error: `Missing scope: ${requiredScope}` };
        }

        // Update usage
        apiKey.lastUsedAt = Date.now();
        apiKey.usageCount++;

        return { valid: true, keyId: apiKey.id, scopes: apiKey.scopes };
      }
    }

    return { valid: false, error: 'Invalid API key' };
  }

  revoke(id: string): boolean {
    const key = this.keys.get(id);
    if (!key) return false;
    key.enabled = false;
    logger.info('API key revoked', { id, name: key.name });
    return true;
  }

  enable(id: string): boolean {
    const key = this.keys.get(id);
    if (!key) return false;
    key.enabled = true;
    return true;
  }

  delete(id: string): boolean {
    const deleted = this.keys.delete(id);
    if (deleted) logger.info('API key deleted', { id });
    return deleted;
  }

  updateScopes(id: string, scopes: string[]): boolean {
    const key = this.keys.get(id);
    if (!key) return false;
    key.scopes = scopes.filter(s => (ALL_SCOPES as readonly string[]).includes(s));
    return true;
  }

  list(): Array<Omit<APIKey, 'keyHash'>> {
    return Array.from(this.keys.values()).map(({ keyHash: _, ...rest }) => rest);
  }

  get(id: string): Omit<APIKey, 'keyHash'> | undefined {
    const key = this.keys.get(id);
    if (!key) return undefined;
    const { keyHash: _, ...rest } = key;
    return rest;
  }

  getScopes(): readonly string[] {
    return ALL_SCOPES;
  }

  getStats(): { total: number; active: number; expired: number; totalUsage: number } {
    let active = 0, expired = 0, totalUsage = 0;
    for (const key of this.keys.values()) {
      if (!key.enabled) continue;
      if (key.expiresAt && Date.now() > key.expiresAt) expired++;
      else active++;
      totalUsage += key.usageCount;
    }
    return { total: this.keys.size, active, expired, totalUsage };
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }
}

export function createAPIKeyManager(): APIKeyManager {
  return new APIKeyManager();
}
