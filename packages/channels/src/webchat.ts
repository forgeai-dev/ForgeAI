import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export class WebChatChannel extends BaseChannel {
  private pendingResponses: Map<string, (message: OutboundMessage) => void> = new Map();

  constructor() {
    super('webchat');
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.logger.info('WebChat channel ready');
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.pendingResponses.clear();
    this.logger.info('WebChat channel disconnected');
  }

  async send(message: OutboundMessage): Promise<void> {
    // WebChat responses are sent back through the pending response callback
    const callback = this.pendingResponses.get(message.recipientId);
    if (callback) {
      callback(message);
      this.pendingResponses.delete(message.recipientId);
    }
  }

  async receiveFromHTTP(params: {
    senderId: string;
    senderName?: string;
    content: string;
    sessionId?: string;
  }): Promise<InboundMessage> {
    const inbound: InboundMessage = {
      id: generateId('wmsg'),
      channelType: 'webchat',
      channelMessageId: generateId('wch'),
      senderId: params.senderId,
      senderName: params.senderName ?? 'WebChat User',
      content: params.content,
      timestamp: new Date(),
      raw: { sessionId: params.sessionId },
    };

    this.logger.debug('WebChat inbound', { senderId: params.senderId });
    await this.handleInbound(inbound);
    return inbound;
  }

  onResponse(recipientId: string): Promise<OutboundMessage> {
    return new Promise((resolve) => {
      this.pendingResponses.set(recipientId, resolve);

      // Timeout after 120s
      setTimeout(() => {
        if (this.pendingResponses.has(recipientId)) {
          this.pendingResponses.delete(recipientId);
          resolve({
            channelType: 'webchat',
            recipientId,
            content: 'Request timed out. Please try again.',
          });
        }
      }, 120_000);
    });
  }
}

export function createWebChatChannel(): WebChatChannel {
  return new WebChatChannel();
}
