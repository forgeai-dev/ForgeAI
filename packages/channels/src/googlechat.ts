import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel, type ChannelWithPermissions } from './base.js';

export interface GoogleChatConfig {
  /** Google Cloud project ID */
  projectId: string;
  /** Service account credentials JSON (stringified or object) */
  credentials?: string | Record<string, unknown>;
  /** Allowed user email addresses */
  allowFrom?: string[];
  /** Allowed space IDs */
  allowSpaces?: string[];
}

interface GoogleChatEvent {
  type: 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'MESSAGE' | 'CARD_CLICKED';
  eventTime?: string;
  token?: { text: string };
  user?: {
    name: string;        // e.g. "users/123456"
    displayName: string;
    email?: string;
    type?: 'HUMAN' | 'BOT';
  };
  space?: {
    name: string;        // e.g. "spaces/AAAA..."
    displayName?: string;
    type: 'DM' | 'ROOM' | 'TYPE_UNSPECIFIED';
    singleUserBotDm?: boolean;
  };
  message?: {
    name: string;        // e.g. "spaces/XXX/messages/YYY"
    sender?: { name: string; displayName: string; email?: string };
    createTime?: string;
    text?: string;
    argumentText?: string;
    thread?: { name: string };
    annotations?: Array<{ type: string; startIndex: number; length: number }>;
    attachment?: Array<{ name: string; contentName: string; contentType: string; downloadUri: string }>;
  };
}

interface GoogleChatResponse {
  text?: string;
  thread?: { name: string };
  cardsV2?: unknown[];
}

// Pending responses for synchronous webhook replies
type PendingReply = { resolve: (value: GoogleChatResponse) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Google Chat channel using Google Workspace API (webhook-based).
 *
 * Setup:
 * 1. Create a Google Cloud project (https://console.cloud.google.com)
 * 2. Enable the Google Chat API
 * 3. Create a Chat App (bot) in the Google Chat API settings
 * 4. Configure the App URL to: https://your-domain/api/googlechat/webhook
 * 5. Set GOOGLE_CHAT_PROJECT_ID in your .env
 * 6. (Optional) Download service account JSON for async messaging
 *
 * How it works:
 * - Google Chat sends events to our webhook (POST /api/googlechat/webhook)
 * - We process the message and respond synchronously (within 30s)
 * - For longer responses, we use the Google Chat REST API (async)
 */
export class GoogleChatChannel extends BaseChannel implements ChannelWithPermissions {
  private config: GoogleChatConfig;
  private allowedUsers: Set<string>;
  private allowedSpaces: Set<string>;
  private adminUsers: Set<string> = new Set();
  private pendingReplies: Map<string, PendingReply> = new Map();
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: GoogleChatConfig) {
    super('googlechat');
    this.config = config;
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedSpaces = new Set(config.allowSpaces ?? []);
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.logger.info('Google Chat channel ready (webhook mode)');
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    // Clear all pending replies
    for (const [, pending] of this.pendingReplies) {
      clearTimeout(pending.timer);
      pending.resolve({ text: '(disconnected)' });
    }
    this.pendingReplies.clear();
    this.logger.info('Google Chat channel disconnected');
  }

  /**
   * Process incoming webhook event from Google Chat.
   * Returns a response object for synchronous reply, or null to use async.
   */
  async processWebhook(event: GoogleChatEvent): Promise<GoogleChatResponse | null> {
    if (event.type === 'ADDED_TO_SPACE') {
      const spaceName = event.space?.displayName ?? event.space?.name ?? 'unknown';
      this.logger.info(`Added to space: ${spaceName}`);
      return { text: `🔥 ForgeAI conectado! Envie uma mensagem para começar.` };
    }

    if (event.type === 'REMOVED_FROM_SPACE') {
      this.logger.info(`Removed from space: ${event.space?.name}`);
      return null;
    }

    if (event.type !== 'MESSAGE' || !event.message) {
      return null;
    }

    const userEmail = event.user?.email ?? event.message?.sender?.email ?? '';
    const userName = event.user?.displayName ?? event.message?.sender?.displayName ?? 'Unknown';
    const userId = event.user?.name ?? 'unknown';
    const spaceId = event.space?.name ?? '';

    // Check permissions
    if (this.allowedUsers.size > 0 && userEmail && !this.allowedUsers.has(userEmail) && !this.allowedUsers.has(userId)) {
      this.logger.debug(`Ignoring message from unauthorized user: ${userEmail}`);
      return { text: '⛔ Você não tem permissão para usar este bot.' };
    }

    if (this.allowedSpaces.size > 0 && spaceId && !this.allowedSpaces.has(spaceId)) {
      this.logger.debug(`Ignoring message from unauthorized space: ${spaceId}`);
      return null;
    }

    // Extract text — remove @mention prefix
    let text = event.message.argumentText?.trim() ?? event.message.text?.trim() ?? '';
    if (!text) return null;

    // Build inbound message
    const inbound: InboundMessage = {
      id: generateId(),
      channelType: 'googlechat',
      channelMessageId: event.message.name ?? generateId(),
      senderId: userEmail || userId,
      senderName: userName,
      groupId: event.space?.type !== 'DM' ? spaceId : undefined,
      content: text,
      timestamp: event.message.createTime ? new Date(event.message.createTime) : new Date(),
      raw: event as unknown as Record<string, unknown>,
    };

    // Create a promise that will be resolved when send() is called
    const replyPromise = new Promise<GoogleChatResponse>((resolve) => {
      const timer = setTimeout(() => {
        // Timeout after 25s (Google Chat webhook timeout is 30s)
        this.pendingReplies.delete(inbound.id);
        resolve({ text: '⏳ Processando... a resposta será enviada em breve.' });
      }, 25_000);

      this.pendingReplies.set(inbound.id, { resolve, timer });
    });

    // Process the inbound message (async — will call send() when done)
    this.handleInbound(inbound).catch(err => {
      this.logger.error('Error handling Google Chat message', { error: String(err) });
      const pending = this.pendingReplies.get(inbound.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve({ text: '❌ Erro ao processar mensagem.' });
        this.pendingReplies.delete(inbound.id);
      }
    });

    // Wait for reply (sync response to webhook)
    const response = await replyPromise;

    // Thread reply if applicable
    if (event.message.thread?.name) {
      response.thread = { name: event.message.thread.name };
    }

    return response;
  }

  async send(message: OutboundMessage): Promise<void> {
    const content = message.content;

    // Check if we have a pending sync reply for this message
    // The recipientId should match the inbound message ID
    const pending = this.pendingReplies.get(message.recipientId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingReplies.delete(message.recipientId);

      // Chunk if needed (Google Chat max message = 4096 chars)
      if (content.length > 4096) {
        pending.resolve({ text: content.substring(0, 4096) });
        // Send remaining via async API
        const remaining = content.substring(4096);
        if (remaining.length > 0 && message.groupId) {
          await this.sendAsync(message.groupId, remaining);
        }
      } else {
        pending.resolve({ text: content });
      }
      return;
    }

    // Async send via Google Chat REST API
    if (message.groupId) {
      await this.sendAsync(message.groupId, content);
    } else {
      this.logger.warn('Cannot send async message: no space/groupId available');
    }
  }

  /**
   * Send a message via Google Chat REST API (for async replies).
   * Requires service account credentials.
   */
  private async sendAsync(spaceName: string, text: string): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (!token) {
        this.logger.warn('Cannot send async: no access token (missing service account credentials)');
        return;
      }

      const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;
      const chunks = this.chunkText(text, 4096);

      for (const chunk of chunks) {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: chunk }),
        });

        if (!response.ok) {
          const body = await response.text();
          this.logger.error('Google Chat API error', { status: response.status, body });
        }
      }
    } catch (err) {
      this.logger.error('Failed to send async message', { error: String(err) });
    }
  }

  /**
   * Get OAuth2 access token using service account credentials.
   */
  private async getAccessToken(): Promise<string | null> {
    if (!this.config.credentials) return null;

    // Check if cached token is still valid
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    try {
      const creds = typeof this.config.credentials === 'string'
        ? JSON.parse(this.config.credentials)
        : this.config.credentials;

      // Build JWT for service account
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/chat.bot',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })).toString('base64url');

      const { createSign } = await import('node:crypto');
      const sign = createSign('RSA-SHA256');
      sign.update(`${header}.${payload}`);
      const signature = sign.sign(creds.private_key, 'base64url');

      const jwt = `${header}.${payload}.${signature}`;

      // Exchange JWT for access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });

      if (!tokenResponse.ok) {
        this.logger.error('Failed to get access token', { status: tokenResponse.status });
        return null;
      }

      const data = await tokenResponse.json() as { access_token: string; expires_in: number };
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + data.expires_in * 1000;
      return this.accessToken;
    } catch (err) {
      this.logger.error('Failed to get access token', { error: String(err) });
      return null;
    }
  }

  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.substring(i, i + maxLen));
    }
    return chunks;
  }

  // ─── ChannelWithPermissions ────────────────────────────

  addAllowedUser(userId: string): void { this.allowedUsers.add(userId); }
  removeAllowedUser(userId: string): void { this.allowedUsers.delete(userId); }
  addAllowedGroup(groupId: string): void { this.allowedSpaces.add(groupId); }
  removeAllowedGroup(groupId: string): void { this.allowedSpaces.delete(groupId); }
  addAdmin(userId: string): void { this.adminUsers.add(userId); }
  removeAdmin(userId: string): void { this.adminUsers.delete(userId); }

  getPermissions() {
    return {
      allowedUsers: Array.from(this.allowedUsers),
      allowedGroups: Array.from(this.allowedSpaces),
      adminUsers: Array.from(this.adminUsers),
    };
  }
}

export function createGoogleChatChannel(config: GoogleChatConfig): GoogleChatChannel {
  return new GoogleChatChannel(config);
}
