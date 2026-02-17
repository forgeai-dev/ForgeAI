import { createLogger, generateId } from '@forgeai/shared';

const logger = createLogger('Core:WebhookManager');

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret?: string;
  events: string[];
  enabled: boolean;
  headers?: Record<string, string>;
  createdAt: Date;
  lastTriggered?: Date;
  triggerCount: number;
}

export interface InboundWebhook {
  id: string;
  name: string;
  path: string;
  secret?: string;
  enabled: boolean;
  handler: string;
  createdAt: Date;
  lastReceived?: Date;
  receiveCount: number;
}

export interface WebhookEvent {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  createdAt: Date;
  deliveredAt?: Date;
  error?: string;
}

export class WebhookManager {
  private outbound: Map<string, WebhookConfig> = new Map();
  private inbound: Map<string, InboundWebhook> = new Map();
  private eventLog: WebhookEvent[] = [];
  private handlers: Map<string, (payload: unknown) => Promise<unknown>> = new Map();

  constructor() {
    logger.info('Webhook manager initialized');
  }

  // ─── Outbound Webhooks (send events to external URLs) ──────

  registerOutbound(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'triggerCount'>): WebhookConfig {
    const webhook: WebhookConfig = {
      ...config,
      id: generateId(),
      createdAt: new Date(),
      triggerCount: 0,
    };
    this.outbound.set(webhook.id, webhook);
    logger.info('Outbound webhook registered', { id: webhook.id, name: webhook.name });
    return webhook;
  }

  async triggerOutbound(event: string, payload: unknown): Promise<void> {
    for (const webhook of this.outbound.values()) {
      if (!webhook.enabled || !webhook.events.includes(event)) continue;

      const eventRecord: WebhookEvent = {
        id: generateId(),
        webhookId: webhook.id,
        event,
        payload,
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
      };

      try {
        eventRecord.attempts++;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Id': webhook.id,
          ...(webhook.headers ?? {}),
        };

        if (webhook.secret) {
          const { createHmac } = await import('node:crypto');
          const signature = createHmac('sha256', webhook.secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        const res = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          eventRecord.status = 'delivered';
          eventRecord.deliveredAt = new Date();
          webhook.lastTriggered = new Date();
          webhook.triggerCount++;
        } else {
          eventRecord.status = 'failed';
          eventRecord.error = `HTTP ${res.status}: ${res.statusText}`;
        }
      } catch (err) {
        eventRecord.status = 'failed';
        eventRecord.error = String(err);
      }

      this.eventLog.push(eventRecord);
      if (this.eventLog.length > 1000) this.eventLog.shift();
    }
  }

  // ─── Inbound Webhooks (receive events from external sources) ──

  registerInbound(config: { name: string; path: string; secret?: string; handler: string }): InboundWebhook {
    const webhook: InboundWebhook = {
      id: generateId(),
      name: config.name,
      path: config.path.startsWith('/') ? config.path : `/${config.path}`,
      secret: config.secret,
      enabled: true,
      handler: config.handler,
      createdAt: new Date(),
      receiveCount: 0,
    };
    this.inbound.set(webhook.id, webhook);
    logger.info('Inbound webhook registered', { id: webhook.id, path: webhook.path });
    return webhook;
  }

  registerHandler(name: string, handler: (payload: unknown) => Promise<unknown>): void {
    this.handlers.set(name, handler);
  }

  async processInbound(path: string, payload: unknown, signature?: string): Promise<{ handled: boolean; result?: unknown; error?: string }> {
    for (const webhook of this.inbound.values()) {
      if (!webhook.enabled || webhook.path !== path) continue;

      // Verify signature if secret is set
      if (webhook.secret && signature) {
        const { createHmac } = await import('node:crypto');
        const expected = `sha256=${createHmac('sha256', webhook.secret).update(JSON.stringify(payload)).digest('hex')}`;
        if (signature !== expected) {
          logger.warn('Inbound webhook signature mismatch', { path });
          return { handled: false, error: 'Invalid signature' };
        }
      }

      webhook.lastReceived = new Date();
      webhook.receiveCount++;

      const handler = this.handlers.get(webhook.handler);
      if (!handler) {
        return { handled: false, error: `Handler '${webhook.handler}' not found` };
      }

      try {
        const result = await handler(payload);
        return { handled: true, result };
      } catch (err) {
        return { handled: false, error: String(err) };
      }
    }

    return { handled: false, error: `No webhook registered for path: ${path}` };
  }

  // ─── Management ────────────────────────────────────────────

  listOutbound(): WebhookConfig[] {
    return Array.from(this.outbound.values());
  }

  listInbound(): InboundWebhook[] {
    return Array.from(this.inbound.values());
  }

  getEventLog(limit: number = 50): WebhookEvent[] {
    return this.eventLog.slice(-limit);
  }

  removeOutbound(id: string): boolean {
    return this.outbound.delete(id);
  }

  removeInbound(id: string): boolean {
    return this.inbound.delete(id);
  }

  toggleOutbound(id: string, enabled: boolean): boolean {
    const wh = this.outbound.get(id);
    if (!wh) return false;
    wh.enabled = enabled;
    return true;
  }

  toggleInbound(id: string, enabled: boolean): boolean {
    const wh = this.inbound.get(id);
    if (!wh) return false;
    wh.enabled = enabled;
    return true;
  }
}

export function createWebhookManager(): WebhookManager {
  return new WebhookManager();
}
