import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
  type CipherGCMTypes,
} from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  VAULT_ALGORITHM,
  VAULT_ITERATIONS,
  VAULT_KEY_LENGTH,
  VAULT_SALT_LENGTH,
  VAULT_IV_LENGTH,
  createLogger,
} from '@forgeai/shared';

const logger = createLogger('Security:Vault');

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  version: number;
}

export class Vault {
  private derivedKey: Buffer | null = null;
  private salt: Buffer | null = null;
  private store: Map<string, EncryptedPayload> = new Map();
  private filePath: string | null = null;

  async initialize(masterPassword: string, existingSalt?: string, filePath?: string): Promise<void> {
    if (filePath) {
      this.filePath = filePath;
    }

    // Try to load salt from existing vault file first
    const savedSalt = this.loadSaltFromDisk();

    this.salt = existingSalt
      ? Buffer.from(existingSalt, 'hex')
      : savedSalt
        ? Buffer.from(savedSalt, 'hex')
        : randomBytes(VAULT_SALT_LENGTH);

    this.derivedKey = pbkdf2Sync(
      masterPassword,
      this.salt,
      VAULT_ITERATIONS,
      VAULT_KEY_LENGTH,
      'sha512'
    );

    if (this.filePath) {
      this.loadFromDisk();
    }

    logger.info('Vault initialized', { persistent: !!filePath, entries: this.store.size });
  }

  isInitialized(): boolean {
    return this.derivedKey !== null;
  }

  getSalt(): string {
    if (!this.salt) throw new Error('Vault not initialized');
    return this.salt.toString('hex');
  }

  encrypt(plaintext: string): EncryptedPayload {
    if (!this.derivedKey || !this.salt) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }

    const iv = randomBytes(VAULT_IV_LENGTH);
    const cipher = createCipheriv(
      VAULT_ALGORITHM as CipherGCMTypes,
      this.derivedKey,
      iv,
    );

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      salt: this.salt.toString('hex'),
      version: 1,
    };
  }

  decrypt(payload: EncryptedPayload): string {
    if (!this.derivedKey) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }

    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');

    const decipher = createDecipheriv(
      VAULT_ALGORITHM as CipherGCMTypes,
      this.derivedKey,
      iv,
    );
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  set(key: string, value: string): void {
    const encrypted = this.encrypt(value);
    this.store.set(key, encrypted);
    this.saveToDisk();
    logger.debug('Vault entry set', { key });
  }

  get(key: string): string | null {
    const encrypted = this.store.get(key);
    if (!encrypted) return null;
    return this.decrypt(encrypted);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    const result = this.store.delete(key);
    if (result) {
      this.saveToDisk();
      logger.debug('Vault entry deleted', { key });
    }
    return result;
  }

  listKeys(): string[] {
    return Array.from(this.store.keys());
  }

  exportEncrypted(): Record<string, EncryptedPayload> {
    const exported: Record<string, EncryptedPayload> = {};
    for (const [key, value] of this.store.entries()) {
      exported[key] = value;
    }
    return exported;
  }

  importEncrypted(data: Record<string, EncryptedPayload>): void {
    for (const [key, value] of Object.entries(data)) {
      this.store.set(key, value);
    }
    this.saveToDisk();
    logger.info('Vault entries imported', { count: Object.keys(data).length });
  }

  private saveToDisk(): void {
    if (!this.filePath) return;
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const envelope = {
        _salt: this.salt?.toString('hex'),
        _version: 1,
        entries: this.exportEncrypted(),
      };
      writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to save vault to disk', { error: String(err) });
    }
  }

  private loadSaltFromDisk(): string | null {
    if (!this.filePath || !existsSync(this.filePath)) return null;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed._salt) return parsed._salt as string;
    } catch {
      // ignore
    }
    return null;
  }

  private loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Support new envelope format with { _salt, entries } and legacy flat format
      const entries = parsed.entries ?? parsed;
      for (const [key, value] of Object.entries(entries)) {
        if (key.startsWith('_')) continue;
        this.store.set(key, value as EncryptedPayload);
      }
      logger.info('Vault loaded from disk', { entries: this.store.size });
    } catch (err) {
      logger.error('Failed to load vault from disk', { error: String(err) });
    }
  }

  destroy(): void {
    if (this.derivedKey) {
      this.derivedKey.fill(0);
      this.derivedKey = null;
    }
    this.salt = null;
    this.store.clear();
    logger.info('Vault destroyed');
  }
}

export function createVault(): Vault {
  return new Vault();
}
