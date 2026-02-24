import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:HomeAssistant');

export interface HomeAssistantConfig {
  url: string;       // e.g. http://homeassistant.local:8123
  token: string;     // Long-Lived Access Token
}

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  friendly_name?: string;
}

export interface HAService {
  domain: string;
  services: Record<string, { description: string; fields: Record<string, unknown> }>;
}

export interface HAScene {
  entity_id: string;
  name: string;
  state: string;
}

export class HomeAssistantIntegration {
  private config: HomeAssistantConfig | null = null;

  constructor() {
    logger.info('Home Assistant integration initialized');
  }

  configure(config: HomeAssistantConfig): void {
    // Normalize URL: remove trailing slash
    this.config = {
      ...config,
      url: config.url.replace(/\/+$/, ''),
    };
    logger.info('Home Assistant configured', { url: this.config.url });
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.token && !!this.config.url;
  }

  getConfig(): HomeAssistantConfig | null {
    return this.config;
  }

  private getHeaders(): Record<string, string> {
    if (!this.config) throw new Error('Home Assistant not configured');
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl(): string {
    if (!this.config) throw new Error('Home Assistant not configured');
    return this.config.url;
  }

  // ─── Connection Test ───

  async testConnection(): Promise<{ ok: boolean; message?: string; version?: string }> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, message: `HTTP ${res.status}: ${text}` };
      }
      const data = await res.json() as { message?: string };
      return { ok: true, message: data.message || 'Connected', version: (data as Record<string, string>).version };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  // ─── States ───

  async getStates(): Promise<HAEntity[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/states`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Failed to get states: HTTP ${res.status}`);
    const data = await res.json() as Array<Record<string, unknown>>;
    return data.map(e => this.mapEntity(e));
  }

  async getState(entityId: string): Promise<HAEntity> {
    const res = await fetch(`${this.getBaseUrl()}/api/states/${encodeURIComponent(entityId)}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Entity not found: ${entityId} (HTTP ${res.status})`);
    const data = await res.json() as Record<string, unknown>;
    return this.mapEntity(data);
  }

  // ─── Services (turn_on, turn_off, toggle, etc.) ───

  async callService(domain: string, service: string, data?: Record<string, unknown>): Promise<HAEntity[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data || {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Service call failed: ${domain}.${service} — HTTP ${res.status}: ${text}`);
    }
    const result = await res.json() as Array<Record<string, unknown>>;
    return Array.isArray(result) ? result.map(e => this.mapEntity(e)) : [];
  }

  // ─── Convenience methods ───

  async turnOn(entityId: string, serviceData?: Record<string, unknown>): Promise<HAEntity[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_on', { entity_id: entityId, ...serviceData });
  }

  async turnOff(entityId: string, serviceData?: Record<string, unknown>): Promise<HAEntity[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_off', { entity_id: entityId, ...serviceData });
  }

  async toggle(entityId: string): Promise<HAEntity[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'toggle', { entity_id: entityId });
  }

  async activateScene(sceneId: string): Promise<HAEntity[]> {
    return this.callService('scene', 'turn_on', { entity_id: sceneId });
  }

  async setLightBrightness(entityId: string, brightness: number): Promise<HAEntity[]> {
    // Brightness: 0-255
    return this.callService('light', 'turn_on', {
      entity_id: entityId,
      brightness: Math.max(0, Math.min(255, Math.round(brightness * 2.55))),
    });
  }

  async setLightColor(entityId: string, color: { r: number; g: number; b: number }): Promise<HAEntity[]> {
    return this.callService('light', 'turn_on', {
      entity_id: entityId,
      rgb_color: [color.r, color.g, color.b],
    });
  }

  async setClimate(entityId: string, temperature: number, hvacMode?: string): Promise<HAEntity[]> {
    const data: Record<string, unknown> = { entity_id: entityId, temperature };
    if (hvacMode) data.hvac_mode = hvacMode;
    return this.callService('climate', 'set_temperature', data);
  }

  // ─── Discovery helpers ───

  async listDevicesByDomain(domain?: string): Promise<HAEntity[]> {
    const states = await this.getStates();
    if (!domain) return states;
    return states.filter(e => e.entity_id.startsWith(`${domain}.`));
  }

  async listScenes(): Promise<HAScene[]> {
    const states = await this.getStates();
    return states
      .filter(e => e.entity_id.startsWith('scene.'))
      .map(e => ({
        entity_id: e.entity_id,
        name: (e.attributes.friendly_name as string) || e.entity_id,
        state: e.state,
      }));
  }

  async listAutomations(): Promise<HAEntity[]> {
    return this.listDevicesByDomain('automation');
  }

  // ─── Utility ───

  private mapEntity(raw: Record<string, unknown>): HAEntity {
    const attrs = (raw.attributes || {}) as Record<string, unknown>;
    return {
      entity_id: String(raw.entity_id || ''),
      state: String(raw.state || 'unknown'),
      attributes: attrs,
      last_changed: String(raw.last_changed || ''),
      last_updated: String(raw.last_updated || ''),
      friendly_name: attrs.friendly_name as string | undefined,
    };
  }
}

export function createHomeAssistantIntegration(): HomeAssistantIntegration {
  return new HomeAssistantIntegration();
}
