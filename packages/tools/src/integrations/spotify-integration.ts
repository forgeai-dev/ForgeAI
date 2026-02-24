import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:Spotify');

const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  uri: string;
  url: string;
}

export interface SpotifyPlayback {
  is_playing: boolean;
  device: SpotifyDevice | null;
  track: SpotifyTrack | null;
  progress_ms: number;
  shuffle: boolean;
  repeat: string;
  volume: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  tracks_total: number;
  uri: string;
  url: string;
}

export interface SpotifySearchResult {
  tracks: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
}

export class SpotifyIntegration {
  private config: SpotifyConfig | null = null;
  private tokens: SpotifyTokens | null = null;
  private onTokenRefresh: ((tokens: SpotifyTokens) => void) | null = null;

  constructor() {
    logger.info('Spotify integration initialized');
  }

  configure(config: SpotifyConfig): void {
    this.config = config;
    logger.info('Spotify configured', { clientId: config.clientId, redirectUri: config.redirectUri });
  }

  setTokens(tokens: SpotifyTokens): void {
    this.tokens = tokens;
    logger.info('Spotify tokens set', { expiresAt: new Date(tokens.expiresAt).toISOString() });
  }

  onTokensRefreshed(callback: (tokens: SpotifyTokens) => void): void {
    this.onTokenRefresh = callback;
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.clientId && !!this.config.clientSecret;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && !!this.tokens.accessToken;
  }

  getConfig(): SpotifyConfig | null {
    return this.config;
  }

  // ─── OAuth2 Flow ───

  getAuthorizeUrl(state?: string): string {
    if (!this.config) throw new Error('Spotify not configured');
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: SCOPES,
      show_dialog: 'true',
    });
    if (state) params.set('state', state);
    return `${SPOTIFY_ACCOUNTS_URL}/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<SpotifyTokens> {
    if (!this.config) throw new Error('Spotify not configured');

    const res = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token exchange failed: HTTP ${res.status} — ${text}`);
    }

    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    const tokens: SpotifyTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.tokens = tokens;
    logger.info('Spotify tokens obtained via code exchange');
    return tokens;
  }

  async refreshAccessToken(): Promise<SpotifyTokens> {
    if (!this.config || !this.tokens?.refreshToken) {
      throw new Error('Cannot refresh: missing config or refresh token');
    }

    const res = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token refresh failed: HTTP ${res.status} — ${text}`);
    }

    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    logger.info('Spotify access token refreshed');
    if (this.onTokenRefresh) this.onTokenRefresh(this.tokens);
    return this.tokens;
  }

  // ─── API Helpers ───

  private async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error('Spotify not authenticated. Please connect via Dashboard Settings.');
    // Auto-refresh if expired (with 60s buffer)
    if (Date.now() >= this.tokens.expiresAt - 60_000) {
      await this.refreshAccessToken();
    }
    return this.tokens!.accessToken;
  }

  private async apiGet(path: string): Promise<unknown> {
    const token = await this.getAccessToken();
    const res = await fetch(`${SPOTIFY_API_URL}${path}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Spotify API error: ${res.status} ${path} — ${text}`);
    }
    return res.json();
  }

  private async apiPut(path: string, body?: unknown): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${SPOTIFY_API_URL}${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => '');
      throw new Error(`Spotify API error: ${res.status} ${path} — ${text}`);
    }
  }

  private async apiPost(path: string, body?: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const res = await fetch(`${SPOTIFY_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Spotify API error: ${res.status} ${path} — ${text}`);
    }
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) return res.json();
    return null;
  }

  // ─── Playback ───

  async getPlayback(): Promise<SpotifyPlayback> {
    const data = await this.apiGet('/me/player') as Record<string, unknown> | null;
    if (!data) return { is_playing: false, device: null, track: null, progress_ms: 0, shuffle: false, repeat: 'off', volume: 0 };

    const item = data.item as Record<string, unknown> | undefined;
    const device = data.device as Record<string, unknown> | undefined;

    return {
      is_playing: !!data.is_playing,
      device: device ? {
        id: String(device.id || ''),
        name: String(device.name || ''),
        type: String(device.type || ''),
        is_active: !!device.is_active,
        volume_percent: Number(device.volume_percent ?? 0),
      } : null,
      track: item ? this.mapTrack(item) : null,
      progress_ms: Number(data.progress_ms ?? 0),
      shuffle: !!data.shuffle_state,
      repeat: String(data.repeat_state || 'off'),
      volume: device ? Number(device.volume_percent ?? 0) : 0,
    };
  }

  async play(options?: { contextUri?: string; uris?: string[]; deviceId?: string }): Promise<void> {
    const params = options?.deviceId ? `?device_id=${options.deviceId}` : '';
    const body: Record<string, unknown> = {};
    if (options?.contextUri) body.context_uri = options.contextUri;
    if (options?.uris) body.uris = options.uris;
    await this.apiPut(`/me/player/play${params}`, Object.keys(body).length > 0 ? body : undefined);
  }

  async pause(): Promise<void> {
    await this.apiPut('/me/player/pause');
  }

  async next(): Promise<void> {
    await this.apiPost('/me/player/next');
  }

  async previous(): Promise<void> {
    await this.apiPost('/me/player/previous');
  }

  async setVolume(percent: number): Promise<void> {
    const vol = Math.max(0, Math.min(100, Math.round(percent)));
    await this.apiPut(`/me/player/volume?volume_percent=${vol}`);
  }

  async setShuffle(state: boolean): Promise<void> {
    await this.apiPut(`/me/player/shuffle?state=${state}`);
  }

  async setRepeat(state: 'track' | 'context' | 'off'): Promise<void> {
    await this.apiPut(`/me/player/repeat?state=${state}`);
  }

  async addToQueue(uri: string): Promise<void> {
    await this.apiPost(`/me/player/queue?uri=${encodeURIComponent(uri)}`);
  }

  async transferPlayback(deviceId: string, play = true): Promise<void> {
    await this.apiPut('/me/player', { device_ids: [deviceId], play });
  }

  // ─── Devices ───

  async getDevices(): Promise<SpotifyDevice[]> {
    const data = await this.apiGet('/me/player/devices') as { devices: Array<Record<string, unknown>> };
    return (data.devices || []).map(d => ({
      id: String(d.id || ''),
      name: String(d.name || ''),
      type: String(d.type || ''),
      is_active: !!d.is_active,
      volume_percent: Number(d.volume_percent ?? 0),
    }));
  }

  // ─── Search ───

  async search(query: string, types: string[] = ['track', 'playlist'], limit = 5): Promise<SpotifySearchResult> {
    const params = new URLSearchParams({
      q: query,
      type: types.join(','),
      limit: String(limit),
      market: 'from_token',
    });
    const data = await this.apiGet(`/search?${params}`) as Record<string, unknown>;

    const tracks: SpotifyTrack[] = [];
    const playlists: SpotifyPlaylist[] = [];

    if (data.tracks) {
      const items = ((data.tracks as Record<string, unknown>).items || []) as Array<Record<string, unknown>>;
      for (const t of items) tracks.push(this.mapTrack(t));
    }
    if (data.playlists) {
      const items = ((data.playlists as Record<string, unknown>).items || []) as Array<Record<string, unknown>>;
      for (const p of items) playlists.push(this.mapPlaylist(p));
    }

    return { tracks, playlists };
  }

  // ─── Playlists ───

  async getMyPlaylists(limit = 20): Promise<SpotifyPlaylist[]> {
    const data = await this.apiGet(`/me/playlists?limit=${limit}`) as { items: Array<Record<string, unknown>> };
    return (data.items || []).map(p => this.mapPlaylist(p));
  }

  // ─── Mappers ───

  private mapTrack(raw: Record<string, unknown>): SpotifyTrack {
    const artists = (raw.artists || []) as Array<Record<string, unknown>>;
    const album = (raw.album || {}) as Record<string, unknown>;
    const extUrls = (raw.external_urls || {}) as Record<string, string>;
    return {
      name: String(raw.name || ''),
      artist: artists.map(a => String(a.name || '')).join(', '),
      album: String(album.name || ''),
      duration_ms: Number(raw.duration_ms ?? 0),
      uri: String(raw.uri || ''),
      url: extUrls.spotify || '',
    };
  }

  private mapPlaylist(raw: Record<string, unknown>): SpotifyPlaylist {
    const tracks = (raw.tracks || {}) as Record<string, unknown>;
    const extUrls = (raw.external_urls || {}) as Record<string, string>;
    return {
      id: String(raw.id || ''),
      name: String(raw.name || ''),
      description: String(raw.description || ''),
      tracks_total: Number(tracks.total ?? 0),
      uri: String(raw.uri || ''),
      url: extUrls.spotify || '',
    };
  }
}

export function createSpotifyIntegration(): SpotifyIntegration {
  return new SpotifyIntegration();
}
