/**
 * Config Sync — Securely transfer Gateway configuration to a remote instance.
 *
 * Flow:
 * 1. Remote Gateway generates a one-time sync code (8-char, 5min TTL)
 * 2. User enters the code + remote URL on local Gateway/Companion
 * 3. Local exports all vault keys → encrypts with sync code (AES-256-GCM) → POSTs to remote
 * 4. Remote decrypts using its stored code → imports into vault
 *
 * Security:
 * - Sync code never travels over the wire (local encrypts, remote already knows it)
 * - AES-256-GCM with PBKDF2 key derivation from sync code
 * - Code expires after 5 minutes, single use
 * - Rate-limited: max 3 attempts per 5 minutes
 * - Full audit logging
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
  type CipherGCMTypes,
} from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@forgeai/shared';
import type { Vault } from '@forgeai/security';

const logger = createLogger('Core:ConfigSync');

// ─── Constants ───
const SYNC_CODE_LENGTH = 8;
const SYNC_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SYNC_RATE_LIMIT_MAX = 3;
const SYNC_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Encryption params (independent of vault's own encryption)
const SYNC_ALGORITHM = 'aes-256-gcm' as CipherGCMTypes;
const SYNC_ITERATIONS = 100_000;
const SYNC_KEY_LENGTH = 32;
const SYNC_SALT_LENGTH = 32;
const SYNC_IV_LENGTH = 16;

// ─── Types ───
interface SyncCodeEntry {
  code: string;
  createdAt: number;
  used: boolean;
  ip: string;
}

interface EncryptedSyncBundle {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  version: number;
  timestamp: number;
  entryCount: number;
}

interface ConfigBundle {
  entries: Record<string, string>; // key → plaintext value
  sourceVersion: string;
  exportedAt: string;
}

// ─── Rate Limiter (simple in-memory) ───
const rateLimitMap = new Map<string, { count: number; firstAttempt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.firstAttempt > SYNC_RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  if (entry.count >= SYNC_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Sync Code Storage (in-memory, single active code) ───
let pendingSyncCode: SyncCodeEntry | null = null;

function generateSyncCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  let code = '';
  const bytes = randomBytes(SYNC_CODE_LENGTH);
  for (let i = 0; i < SYNC_CODE_LENGTH; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ─── Encryption/Decryption (independent of vault) ───
function encryptBundle(plaintext: string, passphrase: string): EncryptedSyncBundle {
  const salt = randomBytes(SYNC_SALT_LENGTH);
  const key = pbkdf2Sync(passphrase, salt, SYNC_ITERATIONS, SYNC_KEY_LENGTH, 'sha512');
  const iv = randomBytes(SYNC_IV_LENGTH);

  const cipher = createCipheriv(SYNC_ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex'),
    version: 1,
    timestamp: Date.now(),
    entryCount: 0, // set by caller
  };
}

function decryptBundle(bundle: EncryptedSyncBundle, passphrase: string): string {
  const salt = Buffer.from(bundle.salt, 'hex');
  const key = pbkdf2Sync(passphrase, salt, SYNC_ITERATIONS, SYNC_KEY_LENGTH, 'sha512');
  const iv = Buffer.from(bundle.iv, 'hex');
  const tag = Buffer.from(bundle.tag, 'hex');

  const decipher = createDecipheriv(SYNC_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(bundle.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

// ─── Vault Export (decrypt all keys to plaintext) ───
function exportVaultPlaintext(vault: Vault): ConfigBundle {
  const keys = vault.listKeys();
  const entries: Record<string, string> = {};

  for (const key of keys) {
    try {
      const value = vault.get(key);
      if (value !== null) {
        entries[key] = value;
      }
    } catch (err) {
      logger.warn(`Failed to export vault key: ${key}`, { error: String(err) });
    }
  }

  return {
    entries,
    sourceVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
  };
}

// ─── Vault Import (set plaintext values) ───
function importIntoVault(vault: Vault, bundle: ConfigBundle): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(bundle.entries)) {
    try {
      vault.set(key, value);
      imported++;
    } catch (err) {
      logger.warn(`Failed to import vault key: ${key}`, { error: String(err) });
      skipped++;
    }
  }

  return { imported, skipped };
}

// ─── Route Registration ───
export function registerConfigSyncRoutes(app: FastifyInstance, vault: Vault): void {
  /**
   * POST /api/config/sync-init
   * Generate a one-time sync code on THIS Gateway (the receiver/remote).
   * Returns the code to display to the user.
   */
  app.post('/api/config/sync-init', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || 'unknown';

    if (!checkRateLimit(ip)) {
      reply.status(429);
      return { error: 'Too many sync requests. Wait 5 minutes.' };
    }

    if (!vault.isInitialized()) {
      reply.status(503);
      return { error: 'Vault not initialized' };
    }

    const code = generateSyncCode();
    pendingSyncCode = {
      code,
      createdAt: Date.now(),
      used: false,
      ip,
    };

    logger.info('Config sync code generated', { ip, codePrefix: code.substring(0, 3) + '***' });

    return {
      success: true,
      syncCode: code,
      expiresIn: SYNC_CODE_TTL_MS / 1000,
      message: 'Enter this code on the source Gateway to push config here.',
    };
  });

  /**
   * POST /api/config/sync-receive
   * Receive an encrypted config bundle on THIS Gateway (the receiver/remote).
   * Decrypts using the pending sync code and imports into vault.
   */
  app.post('/api/config/sync-receive', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || 'unknown';

    if (!checkRateLimit(ip)) {
      reply.status(429);
      return { error: 'Too many sync attempts. Wait 5 minutes.' };
    }

    if (!vault.isInitialized()) {
      reply.status(503);
      return { error: 'Vault not initialized' };
    }

    // Validate pending sync code exists and is not expired
    if (!pendingSyncCode) {
      reply.status(400);
      return { error: 'No sync code pending. Generate one first via /api/config/sync-init.' };
    }

    if (pendingSyncCode.used) {
      reply.status(400);
      return { error: 'Sync code already used. Generate a new one.' };
    }

    if (Date.now() - pendingSyncCode.createdAt > SYNC_CODE_TTL_MS) {
      pendingSyncCode = null;
      reply.status(400);
      return { error: 'Sync code expired. Generate a new one.' };
    }

    const body = request.body as { bundle?: EncryptedSyncBundle };
    if (!body.bundle || !body.bundle.ciphertext || !body.bundle.iv || !body.bundle.tag || !body.bundle.salt) {
      reply.status(400);
      return { error: 'Invalid bundle format' };
    }

    // Decrypt using stored sync code
    try {
      const plaintext = decryptBundle(body.bundle, pendingSyncCode.code);
      const configBundle: ConfigBundle = JSON.parse(plaintext);

      if (!configBundle.entries || typeof configBundle.entries !== 'object') {
        reply.status(400);
        return { error: 'Invalid config bundle structure' };
      }

      // Import into vault
      const result = importIntoVault(vault, configBundle);

      // Mark sync code as used
      pendingSyncCode.used = true;
      pendingSyncCode = null;

      logger.info('Config sync received and imported', {
        ip,
        imported: result.imported,
        skipped: result.skipped,
        source: configBundle.exportedAt,
      });

      // Auto-restart Gateway after successful import so new config takes effect
      if (result.imported > 0) {
        logger.info('Auto-restarting Gateway to apply imported config...');
        setTimeout(() => {
          process.exit(0); // Docker/systemd will auto-restart the process
        }, 2000); // 2s delay to allow the response to be sent first
      }

      return {
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        message: `Imported ${result.imported} config entries. Gateway is restarting to apply changes.`,
      };
    } catch (err) {
      logger.warn('Config sync decryption failed (wrong code or corrupted bundle)', { ip, error: String(err) });
      reply.status(401);
      return { error: 'Decryption failed. Invalid sync code or corrupted bundle.' };
    }
  });

  /**
   * POST /api/config/sync-push
   * Push config FROM THIS Gateway (the source/local) TO a remote Gateway.
   * Body: { remoteUrl: string, syncCode: string }
   */
  app.post('/api/config/sync-push', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || 'unknown';

    if (!checkRateLimit(ip)) {
      reply.status(429);
      return { error: 'Too many sync requests. Wait 5 minutes.' };
    }

    if (!vault.isInitialized()) {
      reply.status(503);
      return { error: 'Vault not initialized' };
    }

    const body = request.body as { remoteUrl?: string; syncCode?: string };
    if (!body.remoteUrl || !body.syncCode) {
      reply.status(400);
      return { error: 'remoteUrl and syncCode are required' };
    }

    const remoteUrl = body.remoteUrl.replace(/\/+$/, ''); // strip trailing slashes
    const syncCode = body.syncCode.trim().toUpperCase();

    if (syncCode.length !== SYNC_CODE_LENGTH) {
      reply.status(400);
      return { error: `Sync code must be ${SYNC_CODE_LENGTH} characters` };
    }

    // Export vault as plaintext
    const configBundle = exportVaultPlaintext(vault);
    const entryCount = Object.keys(configBundle.entries).length;

    if (entryCount === 0) {
      reply.status(400);
      return { error: 'No config entries to sync (vault is empty)' };
    }

    // Encrypt with sync code
    const plaintext = JSON.stringify(configBundle);
    const encryptedBundle = encryptBundle(plaintext, syncCode);
    encryptedBundle.entryCount = entryCount;

    // Send to remote Gateway
    try {
      const response = await fetch(`${remoteUrl}/api/config/sync-receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: encryptedBundle }),
        signal: AbortSignal.timeout(30_000), // 30s timeout
      });

      const result = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        logger.warn('Config sync push failed', { remoteUrl, status: response.status, error: result.error });
        reply.status(response.status);
        return { error: result.error || 'Remote Gateway rejected the sync' };
      }

      logger.info('Config sync pushed successfully', {
        ip,
        remoteUrl,
        entryCount,
        imported: result.imported,
      });

      return {
        success: true,
        pushed: entryCount,
        imported: result.imported,
        skipped: result.skipped,
        message: result.message || `Pushed ${entryCount} config entries to ${remoteUrl}`,
      };
    } catch (err: any) {
      const errMsg = err.message || String(err);
      logger.error('Config sync push network error', { remoteUrl, error: errMsg });

      if (errMsg.includes('timeout') || errMsg.includes('TimeoutError')) {
        reply.status(504);
        return { error: `Connection to ${remoteUrl} timed out. Check the URL and ensure the remote Gateway is running.` };
      }

      reply.status(502);
      return { error: `Could not connect to ${remoteUrl}: ${errMsg}` };
    }
  });

  /**
   * GET /api/config/sync-status
   * Check if there's a pending sync code and its status.
   */
  app.get('/api/config/sync-status', async () => {
    if (!pendingSyncCode) {
      return { hasPendingCode: false };
    }

    const expired = Date.now() - pendingSyncCode.createdAt > SYNC_CODE_TTL_MS;
    if (expired || pendingSyncCode.used) {
      pendingSyncCode = null;
      return { hasPendingCode: false };
    }

    return {
      hasPendingCode: true,
      createdAt: pendingSyncCode.createdAt,
      expiresAt: pendingSyncCode.createdAt + SYNC_CODE_TTL_MS,
      remainingSeconds: Math.max(0, Math.ceil((SYNC_CODE_TTL_MS - (Date.now() - pendingSyncCode.createdAt)) / 1000)),
    };
  });

  /**
   * GET /api/config/export-summary
   * Returns a summary of what would be synced (no secrets exposed).
   */
  app.get('/api/config/export-summary', async () => {
    if (!vault.isInitialized()) {
      return { error: 'Vault not initialized', entries: [] };
    }

    const keys = vault.listKeys();
    const summary = keys.map(key => {
      // Categorize keys
      let category = 'other';
      if (key.startsWith('env:') && key.includes('API_KEY')) category = 'api_key';
      else if (key.startsWith('env:') && key.includes('TOKEN')) category = 'token';
      else if (key.startsWith('env:') && key.includes('URL')) category = 'url';
      else if (key.startsWith('env:')) category = 'env';
      else if (key.startsWith('models:')) category = 'models';
      else if (key.startsWith('system:')) category = 'system';
      else if (key.startsWith('channel:')) category = 'channel';

      return { key, category };
    });

    return {
      totalEntries: keys.length,
      entries: summary,
      categories: {
        api_keys: summary.filter(s => s.category === 'api_key').length,
        tokens: summary.filter(s => s.category === 'token').length,
        urls: summary.filter(s => s.category === 'url').length,
        env: summary.filter(s => s.category === 'env').length,
        models: summary.filter(s => s.category === 'models').length,
        system: summary.filter(s => s.category === 'system').length,
        channel: summary.filter(s => s.category === 'channel').length,
        other: summary.filter(s => s.category === 'other').length,
      },
    };
  });

  logger.info('Config Sync routes registered');
}
