import { describe, it, expect } from 'vitest';

import { generateId, generateSecret, hashSHA256, generatePairingCode, timingSafeEqual } from '../packages/shared/src/utils/crypto.js';
import { isNonEmptyString, isValidEmail, isValidPort, sanitizeForLog, truncate } from '../packages/shared/src/utils/validation.js';
import { Logger, createLogger } from '../packages/shared/src/utils/logger.js';

// ═══════════════════════════════════════════════════════════════
// 1. CRYPTO UTILS
// ═══════════════════════════════════════════════════════════════
describe('Crypto Utils', () => {
  describe('generateId', () => {
    it('should generate a 32-char hex string by default', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should prepend prefix when provided', () => {
      const id = generateId('usr');
      expect(id).toMatch(/^usr_[0-9a-f]{32}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSecret', () => {
    it('should generate a base64url string of default length', () => {
      const secret = generateSecret();
      expect(secret.length).toBeGreaterThan(10);
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should respect custom length', () => {
      const short = generateSecret(8);
      const long = generateSecret(128);
      expect(long.length).toBeGreaterThan(short.length);
    });

    it('should generate unique secrets', () => {
      const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
      expect(secrets.size).toBe(50);
    });
  });

  describe('hashSHA256', () => {
    it('should return a 64-char hex string', () => {
      const hash = hashSHA256('hello');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should be deterministic', () => {
      expect(hashSHA256('test')).toBe(hashSHA256('test'));
    });

    it('should produce different hashes for different inputs', () => {
      expect(hashSHA256('a')).not.toBe(hashSHA256('b'));
    });

    it('should match known SHA-256 value', () => {
      // SHA-256 of empty string
      expect(hashSHA256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('generatePairingCode', () => {
    it('should return format XXX-XXX (uppercase hex)', () => {
      const code = generatePairingCode();
      expect(code).toMatch(/^[0-9A-F]{3}-[0-9A-F]{3}$/);
    });

    it('should generate different codes', () => {
      const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode()));
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('timingSafeEqual', () => {
    it('should return true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });

    it('should return true for empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. VALIDATION UTILS
// ═══════════════════════════════════════════════════════════════
describe('Validation Utils', () => {
  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(isNonEmptyString('   ')).toBe(false);
    });

    it('should return false for non-string types', () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString(42)).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('should accept valid emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('admin@forgeai.dev')).toBe(true);
      expect(isValidEmail('test+tag@gmail.com')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('notanemail')).toBe(false);
      expect(isValidEmail('@missing.user')).toBe(false);
      expect(isValidEmail('missing@')).toBe(false);
      expect(isValidEmail('has spaces@email.com')).toBe(false);
    });
  });

  describe('isValidPort', () => {
    it('should accept valid ports', () => {
      expect(isValidPort(1)).toBe(true);
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(18800)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    it('should reject invalid ports', () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(3.14)).toBe(false);
      expect(isValidPort(NaN)).toBe(false);
    });
  });

  describe('sanitizeForLog', () => {
    it('should redact sensitive keys', () => {
      const result = sanitizeForLog({
        username: 'admin',
        password: 'secret123',
        apiKey: 'sk-12345',
        token: 'jwt-token',
      });
      expect(result.username).toBe('admin');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const result = sanitizeForLog({
        config: { dbPassword: 'secret', host: 'localhost' },
      });
      const nested = result.config as Record<string, unknown>;
      expect(nested.dbPassword).toBe('[REDACTED]');
      expect(nested.host).toBe('localhost');
    });

    it('should preserve non-sensitive values', () => {
      const result = sanitizeForLog({ name: 'ForgeAI', version: '1.1.0' });
      expect(result.name).toBe('ForgeAI');
      expect(result.version).toBe('1.1.0');
    });

    it('should handle empty objects', () => {
      expect(sanitizeForLog({})).toEqual({});
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 200)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      const long = 'a'.repeat(300);
      const result = truncate(long, 100);
      expect(result.length).toBe(103); // 100 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('should use default maxLength of 200', () => {
      const long = 'b'.repeat(250);
      const result = truncate(long);
      expect(result.length).toBe(203);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. LOGGER
// ═══════════════════════════════════════════════════════════════
describe('Logger', () => {
  it('should create a logger with context', () => {
    const logger = createLogger('TestContext');
    expect(logger).toBeInstanceOf(Logger);
  });

  it('should create child loggers', () => {
    const parent = createLogger('Parent');
    const child = parent.child('Child');
    expect(child).toBeInstanceOf(Logger);
  });

  it('should respect minLevel (debug hidden by default)', () => {
    const logger = createLogger('Test', 'warn');
    // info should not log when minLevel is 'warn'
    // We can't easily assert console output, but at least verify no crash
    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should appear');
    logger.error('should appear');
  });

  it('should handle error objects', () => {
    const logger = createLogger('Test');
    const err = new Error('test error');
    // Should not throw
    logger.error('Something failed', err);
    logger.error('Something failed', { detail: 'info' });
    logger.error('Something failed', 'string error');
    logger.error('Something failed');
  });

  it('should handle fatal with error objects', () => {
    const logger = createLogger('Test');
    logger.fatal('Critical', new Error('fatal error'));
    logger.fatal('Critical', { code: 500 });
  });
});
