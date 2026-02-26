import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createLogger, generateId } from '@forgeai/shared';
import type { UserRole } from '@forgeai/shared';

const logger = createLogger('Security:JWTAuth');

interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
  sessionId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  expiresAt: Date;
}

export class JWTAuth {
  private secret: string;
  private expiresIn: number;
  private refreshSecret: string;
  private revokedTokens: Set<string> = new Set();

  constructor(secret: string, expiresInSeconds?: number) {
    if (!secret || secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.secret = secret;
    this.expiresIn = expiresInSeconds ?? 86400; // 24h in seconds
    this.refreshSecret = secret + ':refresh';
    logger.info('JWT auth initialized');
  }

  generateTokenPair(payload: JWTPayload, expiresInOverride?: number): TokenPair {
    const tokenId = generateId('tok');
    const expiresIn = expiresInOverride ?? this.expiresIn;

    const accessToken = jwt.sign(
      { ...payload, jti: tokenId, type: 'access' },
      this.secret,
      { expiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: payload.userId, jti: generateId('rtk'), type: 'refresh' },
      this.refreshSecret,
      { expiresIn: 604800 } // 7 days in seconds
    );

    const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
    const expiresAt = new Date((decoded.exp ?? 0) * 1000);

    logger.debug('Token pair generated', { userId: payload.userId });

    return {
      accessToken,
      refreshToken,
      expiresIn: `${expiresIn}s`,
      expiresAt,
    };
  }

  verifyAccessToken(token: string): JWTPayload & { jti: string } {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload & { jti: string; type: string };

      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      if (this.revokedTokens.has(decoded.jti)) {
        throw new Error('Token has been revoked');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthError('Token expired', 'TOKEN_EXPIRED');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthError('Invalid token', 'INVALID_TOKEN');
      }
      throw error;
    }
  }

  verifyRefreshToken(token: string): { userId: string; jti: string } {
    try {
      const decoded = jwt.verify(token, this.refreshSecret) as { userId: string; jti: string; type: string };

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      if (this.revokedTokens.has(decoded.jti)) {
        throw new Error('Refresh token has been revoked');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthError('Refresh token expired', 'REFRESH_EXPIRED');
      }
      throw new AuthError('Invalid refresh token', 'INVALID_REFRESH');
    }
  }

  revokeToken(jti: string): void {
    this.revokedTokens.add(jti);
    logger.info('Token revoked', { jti });
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  cleanupRevokedTokens(): void {
    // In production, revoked tokens should be stored in DB with expiry
    // For now, we keep them in memory
    logger.debug('Revoked tokens count', { count: this.revokedTokens.size });
  }
}

export class AuthError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export function createJWTAuth(secret: string, expiresInSeconds?: number): JWTAuth {
  return new JWTAuth(secret, expiresInSeconds);
}
