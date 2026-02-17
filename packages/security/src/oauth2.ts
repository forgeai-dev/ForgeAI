import { createLogger } from '@forgeai/shared';
import crypto from 'node:crypto';

const logger = createLogger('Security:OAuth2');

export interface OAuth2ProviderConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  redirectUri: string;
}

export interface OAuth2Token {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface OAuth2UserInfo {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  provider: string;
  raw: Record<string, unknown>;
}

const BUILTIN_PROVIDERS: Record<string, Omit<OAuth2ProviderConfig, 'clientId' | 'clientSecret' | 'redirectUri'>> = {
  google: {
    name: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    name: 'github',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  microsoft: {
    name: 'microsoft',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
  },
};

export class OAuth2Manager {
  private providers: Map<string, OAuth2ProviderConfig> = new Map();
  private states: Map<string, { provider: string; createdAt: number }> = new Map();
  private tokens: Map<string, OAuth2Token> = new Map();

  constructor() {
    logger.info('OAuth2 manager initialized');
  }

  registerProvider(config: OAuth2ProviderConfig): void {
    this.providers.set(config.name, config);
    logger.info('OAuth2 provider registered', { name: config.name });
  }

  registerBuiltin(name: 'google' | 'github' | 'microsoft', clientId: string, clientSecret: string, redirectUri: string): void {
    const builtin = BUILTIN_PROVIDERS[name];
    if (!builtin) return;
    this.registerProvider({ ...builtin, clientId, clientSecret, redirectUri });
  }

  getAuthorizationUrl(providerName: string): { url: string; state: string } | null {
    const provider = this.providers.get(providerName);
    if (!provider) return null;

    const state = crypto.randomBytes(32).toString('hex');
    this.states.set(state, { provider: providerName, createdAt: Date.now() });

    // Clean old states (> 10min)
    for (const [s, info] of this.states) {
      if (Date.now() - info.createdAt > 600_000) this.states.delete(s);
    }

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
    });

    return { url: `${provider.authorizationUrl}?${params.toString()}`, state };
  }

  async handleCallback(code: string, state: string): Promise<{ user: OAuth2UserInfo; token: OAuth2Token } | { error: string }> {
    const stateInfo = this.states.get(state);
    if (!stateInfo) return { error: 'Invalid or expired state' };
    this.states.delete(state);

    // Check state expiry (10min)
    if (Date.now() - stateInfo.createdAt > 600_000) return { error: 'State expired' };

    const provider = this.providers.get(stateInfo.provider);
    if (!provider) return { error: 'Provider not found' };

    try {
      // Exchange code for token
      const tokenRes = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code,
          redirect_uri: provider.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        return { error: `Token exchange failed: ${tokenRes.status}` };
      }

      const tokenData = await tokenRes.json() as Record<string, unknown>;
      const token: OAuth2Token = {
        accessToken: tokenData.access_token as string,
        refreshToken: tokenData.refresh_token as string | undefined,
        expiresAt: Date.now() + ((tokenData.expires_in as number) ?? 3600) * 1000,
        tokenType: (tokenData.token_type as string) ?? 'Bearer',
        scope: tokenData.scope as string | undefined,
      };

      // Fetch user info
      const userRes = await fetch(provider.userInfoUrl, {
        headers: { Authorization: `${token.tokenType} ${token.accessToken}`, Accept: 'application/json' },
      });

      if (!userRes.ok) {
        return { error: `User info fetch failed: ${userRes.status}` };
      }

      const userData = await userRes.json() as Record<string, unknown>;
      const user = this.normalizeUserInfo(provider.name, userData);

      // Store token
      this.tokens.set(user.id, token);

      logger.info('OAuth2 login successful', { provider: provider.name, userId: user.id });
      return { user, token };
    } catch (err) {
      return { error: `OAuth2 error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  getProviders(): Array<{ name: string; configured: boolean }> {
    return ['google', 'github', 'microsoft'].map(name => ({
      name,
      configured: this.providers.has(name),
    }));
  }

  getConfiguredProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  private normalizeUserInfo(provider: string, data: Record<string, unknown>): OAuth2UserInfo {
    switch (provider) {
      case 'google':
        return {
          id: `google:${data.id}`,
          email: data.email as string,
          name: data.name as string,
          avatar: data.picture as string,
          provider: 'google',
          raw: data,
        };
      case 'github':
        return {
          id: `github:${data.id}`,
          email: data.email as string,
          name: (data.name ?? data.login) as string,
          avatar: data.avatar_url as string,
          provider: 'github',
          raw: data,
        };
      case 'microsoft':
        return {
          id: `microsoft:${data.id}`,
          email: (data.mail ?? data.userPrincipalName) as string,
          name: data.displayName as string,
          avatar: undefined,
          provider: 'microsoft',
          raw: data,
        };
      default:
        return {
          id: `${provider}:${data.id ?? data.sub ?? 'unknown'}`,
          email: data.email as string,
          name: data.name as string,
          provider,
          raw: data,
        };
    }
  }
}

export function createOAuth2Manager(): OAuth2Manager {
  return new OAuth2Manager();
}
