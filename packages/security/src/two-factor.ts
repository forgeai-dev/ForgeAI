import { authenticator } from 'otplib';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Security:2FA');

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeUrl: string;
}

export class TwoFactorAuth {
  private issuer: string;

  constructor(issuer: string = 'ForgeAI') {
    this.issuer = issuer;
    // Set TOTP options
    authenticator.options = {
      digits: 6,
      step: 30,
      window: 1,
    };
  }

  generateSetup(username: string): TwoFactorSetup {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(username, this.issuer, secret);
    // Google Charts QR code API (for simple setup)
    const qrCodeUrl = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`;

    logger.info('2FA setup generated', { username });

    return { secret, otpauthUrl, qrCodeUrl };
  }

  verify(token: string, secret: string): boolean {
    try {
      const isValid = authenticator.verify({ token, secret });

      if (!isValid) {
        logger.warn('2FA verification failed');
      }

      return isValid;
    } catch {
      logger.error('2FA verification error');
      return false;
    }
  }

  generateToken(secret: string): string {
    return authenticator.generate(secret);
  }
}

export function createTwoFactorAuth(issuer?: string): TwoFactorAuth {
  return new TwoFactorAuth(issuer);
}
