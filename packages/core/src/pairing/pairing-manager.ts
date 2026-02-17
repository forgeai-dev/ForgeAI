import { createLogger } from '@forgeai/shared';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const logger = createLogger('Core:Pairing');

// ─── Types ────────────────────────────
export interface PairingCode {
  code: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  usedBy: string[];
  role: 'user' | 'admin';
  label?: string;
  channel?: string;
}

export interface PairingResult {
  success: boolean;
  message: string;
  role?: 'user' | 'admin';
}

export interface PairingGenerateOptions {
  expiresInHours?: number;
  maxUses?: number;
  role?: 'user' | 'admin';
  label?: string;
  channel?: string;
}

// ─── Manager ────────────────────────────
export class PairingManager {
  private codes: Map<string, PairingCode> = new Map();
  private filePath: string;

  constructor(basePath?: string) {
    const base = basePath ?? resolve(process.cwd(), '.forgeai');
    this.filePath = resolve(base, 'pairing-codes.json');
    this.load();
  }

  // ─── Generate a new pairing code ────────────────────────
  generate(options?: PairingGenerateOptions): PairingCode {
    const code = this.createCode();
    const now = new Date();
    const expiresInHours = options?.expiresInHours ?? 24;

    const entry: PairingCode = {
      code,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
      maxUses: options?.maxUses ?? 1,
      usedBy: [],
      role: options?.role ?? 'user',
      label: options?.label,
      channel: options?.channel,
    };

    this.codes.set(code, entry);
    this.save();

    logger.info('Pairing code generated', { code, expiresInHours, maxUses: entry.maxUses, role: entry.role });
    return entry;
  }

  // ─── Validate and use a code ────────────────────────
  redeem(code: string, userId: string, channel?: string): PairingResult {
    const normalized = code.toUpperCase().trim();
    const entry = this.codes.get(normalized);

    if (!entry) {
      return { success: false, message: 'Codigo invalido ou expirado.' };
    }

    // Check expiration
    if (new Date() > new Date(entry.expiresAt)) {
      this.codes.delete(normalized);
      this.save();
      return { success: false, message: 'Codigo expirado.' };
    }

    // Check max uses
    if (entry.usedBy.length >= entry.maxUses) {
      return { success: false, message: 'Codigo ja foi usado o maximo de vezes.' };
    }

    // Check if user already used this code
    if (entry.usedBy.includes(userId)) {
      return { success: false, message: 'Voce ja usou este codigo.' };
    }

    // Check channel restriction
    if (entry.channel && channel && entry.channel !== channel) {
      return { success: false, message: `Este codigo so funciona no canal: ${entry.channel}` };
    }

    // Redeem!
    entry.usedBy.push(userId);
    this.save();

    logger.info('Pairing code redeemed', { code: normalized, userId, role: entry.role });

    return {
      success: true,
      message: 'Pareado com sucesso!',
      role: entry.role,
    };
  }

  // ─── List active codes ────────────────────────
  listCodes(): PairingCode[] {
    this.cleanup();
    return Array.from(this.codes.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // ─── Revoke a code ────────────────────────
  revoke(code: string): boolean {
    const normalized = code.toUpperCase().trim();
    const deleted = this.codes.delete(normalized);
    if (deleted) {
      this.save();
      logger.info('Pairing code revoked', { code: normalized });
    }
    return deleted;
  }

  // ─── Get stats ────────────────────────
  getStats(): { total: number; active: number; expired: number; totalRedeemed: number } {
    const now = new Date();
    let active = 0;
    let expired = 0;
    let totalRedeemed = 0;

    for (const entry of this.codes.values()) {
      if (new Date(entry.expiresAt) < now) {
        expired++;
      } else if (entry.usedBy.length < entry.maxUses) {
        active++;
      }
      totalRedeemed += entry.usedBy.length;
    }

    return { total: this.codes.size, active, expired, totalRedeemed };
  }

  // ─── Internal helpers ────────────────────────
  private createCode(): string {
    const bytes = randomBytes(4);
    const hex = bytes.toString('hex').toUpperCase();
    return `FORGE-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
  }

  private cleanup(): void {
    const now = new Date();
    let removed = 0;
    for (const [code, entry] of this.codes.entries()) {
      if (new Date(entry.expiresAt) < now && entry.usedBy.length >= entry.maxUses) {
        this.codes.delete(code);
        removed++;
      }
    }
    if (removed > 0) {
      this.save();
      logger.debug('Cleaned up expired pairing codes', { removed });
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as PairingCode[];
        for (const entry of data) {
          this.codes.set(entry.code, entry);
        }
        logger.info(`Pairing codes loaded: ${this.codes.size}`);
      }
    } catch (err) {
      logger.error('Failed to load pairing codes', err);
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.codes.values());
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to save pairing codes', err);
    }
  }
}

// ─── Factory ────────────────────────────
export function createPairingManager(basePath?: string): PairingManager {
  return new PairingManager(basePath);
}
