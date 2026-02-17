import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tools:Gmail');

export interface GmailConfig {
  /** OAuth2 access token (from OAuth2Manager) */
  accessToken: string;
  /** OAuth2 refresh token */
  refreshToken?: string;
  /** Google OAuth2 client ID */
  clientId?: string;
  /** Google OAuth2 client secret */
  clientSecret?: string;
  /** Callback for when new emails arrive */
  onEmail?: (email: GmailMessage) => void;
  /** Poll interval in ms (default: 60000 = 1 min) */
  pollIntervalMs?: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  labels: string[];
  isUnread: boolean;
  attachments: GmailAttachment[];
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface GmailSendOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  replyToMessageId?: string;
  threadId?: string;
}

export interface GmailSearchOptions {
  query: string;
  maxResults?: number;
  labelIds?: string[];
}

/**
 * Gmail Integration using Google Gmail API.
 *
 * Setup:
 * 1. Enable Gmail API in Google Cloud Console
 * 2. Configure OAuth2 via Dashboard Settings (Google provider)
 * 3. Grant gmail.readonly + gmail.send + gmail.modify scopes
 *
 * Features:
 * - List/search emails
 * - Read email content
 * - Send emails
 * - Poll for new emails (push notifications planned via Pub/Sub)
 * - Label management
 */
export class GmailIntegration {
  private config: GmailConfig | null = null;
  private baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    logger.info('Gmail integration initialized');
  }

  configure(config: GmailConfig): void {
    this.config = config;
    logger.info('Gmail configured');

    // Start polling if callback is set
    if (config.onEmail && config.pollIntervalMs !== 0) {
      this.startPolling(config.pollIntervalMs ?? 60_000);
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * List recent emails from inbox.
   */
  async listMessages(opts?: { maxResults?: number; labelIds?: string[]; query?: string }): Promise<GmailMessage[]> {
    const params = new URLSearchParams();
    params.set('maxResults', String(opts?.maxResults ?? 10));
    if (opts?.labelIds) params.set('labelIds', opts.labelIds.join(','));
    if (opts?.query) params.set('q', opts.query);

    const data = await this.apiGet(`/messages?${params}`);
    if (!data.messages || !Array.isArray(data.messages)) return [];

    // Fetch full message details (batch)
    const messages: GmailMessage[] = [];
    for (const msg of data.messages.slice(0, opts?.maxResults ?? 10)) {
      try {
        const full = await this.getMessage(msg.id);
        if (full) messages.push(full);
      } catch {
        // Skip failed messages
      }
    }

    return messages;
  }

  /**
   * Get a single email by ID.
   */
  async getMessage(messageId: string): Promise<GmailMessage | null> {
    const data = await this.apiGet(`/messages/${messageId}?format=full`);
    if (!data.id) return null;
    return this.parseMessage(data);
  }

  /**
   * Search emails with Gmail search syntax.
   */
  async search(opts: GmailSearchOptions): Promise<GmailMessage[]> {
    return this.listMessages({
      query: opts.query,
      maxResults: opts.maxResults ?? 10,
      labelIds: opts.labelIds,
    });
  }

  /**
   * Send an email.
   */
  async sendEmail(opts: GmailSendOptions): Promise<{ id: string; threadId: string } | null> {
    const mimeLines = [
      `To: ${opts.to}`,
      opts.cc ? `Cc: ${opts.cc.join(', ')}` : '',
      opts.bcc ? `Bcc: ${opts.bcc.join(', ')}` : '',
      `Subject: ${opts.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      opts.body,
    ].filter(Boolean);

    const raw = Buffer.from(mimeLines.join('\r\n')).toString('base64url');

    const body: Record<string, unknown> = { raw };
    if (opts.threadId) body.threadId = opts.threadId;

    const data = await this.apiPost('/messages/send', body);
    if (!data.id) return null;

    logger.info('Email sent', { to: opts.to, subject: opts.subject });
    return { id: data.id, threadId: data.threadId };
  }

  /**
   * Reply to an email thread.
   */
  async replyToThread(threadId: string, messageId: string, body: string): Promise<{ id: string; threadId: string } | null> {
    // Get original message to extract subject and sender
    const original = await this.getMessage(messageId);
    if (!original) return null;

    return this.sendEmail({
      to: original.from,
      subject: original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`,
      body,
      replyToMessageId: messageId,
      threadId,
    });
  }

  /**
   * Get labels (folders).
   */
  async getLabels(): Promise<Array<{ id: string; name: string; type: string; messagesTotal: number }>> {
    const data = await this.apiGet('/labels');
    if (!data.labels) return [];
    return data.labels.map((l: any) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      messagesTotal: l.messagesTotal ?? 0,
    }));
  }

  /**
   * Mark message as read.
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      await this.apiPost(`/messages/${messageId}/modify`, {
        removeLabelIds: ['UNREAD'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mark message as unread.
   */
  async markAsUnread(messageId: string): Promise<boolean> {
    try {
      await this.apiPost(`/messages/${messageId}/modify`, {
        addLabelIds: ['UNREAD'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get unread count.
   */
  async getUnreadCount(): Promise<number> {
    const data = await this.apiGet('/labels/INBOX');
    return data.messagesUnread ?? 0;
  }

  /**
   * Get email thread (all messages in conversation).
   */
  async getThread(threadId: string): Promise<GmailMessage[]> {
    const data = await this.apiGet(`/threads/${threadId}?format=full`);
    if (!data.messages) return [];
    return data.messages.map((m: any) => this.parseMessage(m));
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Gmail polling stopped');
  }

  // ─── Private ────────────────────────────

  private startPolling(intervalMs: number): void {
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(async () => {
      try {
        await this.checkNewEmails();
      } catch (err) {
        logger.warn('Gmail poll error', { error: String(err) });
      }
    }, intervalMs);

    logger.info(`Gmail polling started (every ${intervalMs / 1000}s)`);

    // Initial check
    this.checkNewEmails().catch(() => {});
  }

  private async checkNewEmails(): Promise<void> {
    if (!this.config?.onEmail) return;

    const messages = await this.listMessages({
      maxResults: 5,
      query: 'is:unread newer_than:2m',
    });

    for (const msg of messages) {
      if (msg.isUnread) {
        this.config.onEmail(msg);
      }
    }
  }

  private parseMessage(data: any): GmailMessage {
    const headers = data.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('From');
    const fromMatch = from.match(/^"?(.+?)"?\s*<(.+?)>$/);

    // Extract body
    let body = '';
    if (data.payload?.body?.data) {
      body = Buffer.from(data.payload.body.data, 'base64url').toString('utf-8');
    } else if (data.payload?.parts) {
      const textPart = data.payload.parts.find((p: any) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      }
    }

    // Extract attachments
    const attachments: GmailAttachment[] = [];
    if (data.payload?.parts) {
      for (const part of data.payload.parts) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size ?? 0,
            attachmentId: part.body.attachmentId,
          });
        }
      }
    }

    return {
      id: data.id,
      threadId: data.threadId,
      from: fromMatch ? fromMatch[2] : from,
      fromName: fromMatch ? fromMatch[1] : from,
      to: getHeader('To').split(',').map((s: string) => s.trim()),
      subject: getHeader('Subject'),
      body,
      snippet: data.snippet ?? '',
      date: getHeader('Date'),
      labels: data.labelIds ?? [],
      isUnread: (data.labelIds ?? []).includes('UNREAD'),
      attachments,
    };
  }

  private async apiGet(path: string): Promise<any> {
    if (!this.config) throw new Error('Gmail not configured');

    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gmail API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  private async apiPost(path: string, body: unknown): Promise<any> {
    if (!this.config) throw new Error('Gmail not configured');

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gmail API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}

export function createGmailIntegration(): GmailIntegration {
  return new GmailIntegration();
}
