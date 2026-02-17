import { randomBytes, createHash } from 'node:crypto';

export function generateId(prefix?: string): string {
  const id = randomBytes(16).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

export function generateSecret(length: number = 64): string {
  return randomBytes(length).toString('base64url');
}

export function hashSHA256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generatePairingCode(): string {
  const code = randomBytes(3).toString('hex').toUpperCase();
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}
