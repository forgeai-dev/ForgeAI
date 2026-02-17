import { App, type SlackEventMiddlewareArgs, type AllMiddlewareArgs } from '@slack/bolt';
import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret?: string;
  allowFrom?: string[];
  allowChannels?: string[];
}

export class SlackChannel extends BaseChannel {
  private app: App;
  private allowedUsers: Set<string>;
  private allowedChannels: Set<string>;

  constructor(config: SlackConfig) {
    super('slack');
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedChannels = new Set(config.allowChannels ?? []);

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle direct messages and mentions
    this.app.message(async ({ message }: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
      // Only handle regular messages (not bot messages, not edits)
      if (!('text' in message) || !message.text) return;
      if ('bot_id' in message && message.bot_id) return;
      if (message.subtype) return;

      const senderId = message.user ?? '';
      const channelId = message.channel ?? '';
      const isGroup = message.channel_type === 'channel' || message.channel_type === 'group';

      // Allowlist check — users
      if (this.allowedUsers.size > 0 && !this.allowedUsers.has(senderId) && !this.allowedUsers.has('*')) {
        this.logger.warn('Message from non-allowed Slack user', { senderId });
        return;
      }

      // Allowlist check — channels
      if (isGroup && this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId) && !this.allowedChannels.has('*')) {
        this.logger.warn('Message from non-allowed Slack channel', { channelId });
        return;
      }

      const inbound: InboundMessage = {
        id: generateId('slmsg'),
        channelType: 'slack',
        channelMessageId: message.ts ?? '',
        senderId,
        senderName: senderId,
        groupId: isGroup ? channelId : undefined,
        content: message.text,
        replyToId: ('thread_ts' in message && message.thread_ts) ? message.thread_ts : undefined,
        timestamp: new Date(parseFloat(message.ts ?? '0') * 1000),
        raw: message as unknown as Record<string, unknown>,
      };

      this.logger.debug('Inbound Slack message', { senderId, channelId, isGroup });
      await this.handleInbound(inbound);
    });

    // Handle app mentions in channels
    this.app.event('app_mention', async ({ event }: { event: Record<string, any> }) => {
      const senderId = (event.user as string) ?? '';
      const channelId = event.channel ?? '';
      const text = event.text ?? '';

      // Remove the bot mention from the text
      const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!cleanText) return;

      if (this.allowedUsers.size > 0 && !this.allowedUsers.has(senderId) && !this.allowedUsers.has('*')) {
        this.logger.warn('Mention from non-allowed Slack user', { senderId });
        return;
      }

      const inbound: InboundMessage = {
        id: generateId('slmsg'),
        channelType: 'slack',
        channelMessageId: event.ts ?? '',
        senderId,
        senderName: senderId,
        groupId: channelId,
        content: cleanText,
        replyToId: ('thread_ts' in event && event.thread_ts) ? event.thread_ts as string : undefined,
        timestamp: new Date(parseFloat(event.ts ?? '0') * 1000),
        raw: event as unknown as Record<string, unknown>,
      };

      this.logger.debug('Inbound Slack mention', { senderId, channelId });
      await this.handleInbound(inbound);
    });
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting Slack bot (Socket Mode)...');

    try {
      await this.app.start();
      this._connected = true;
      this.logger.info('Slack bot connected via Socket Mode');
    } catch (error) {
      this.logger.error('Failed to connect Slack bot', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting Slack bot...');
    await this.app.stop();
    this._connected = false;
    this.logger.info('Slack bot disconnected');
  }

  async send(message: OutboundMessage): Promise<void> {
    const channel = message.groupId ?? message.recipientId;

    try {
      if (message.content.length > 4000) {
        const chunks = this.splitMessage(message.content, 4000);
        for (const chunk of chunks) {
          await this.app.client.chat.postMessage({
            channel,
            text: chunk,
            thread_ts: message.replyToId,
          });
        }
      } else {
        await this.app.client.chat.postMessage({
          channel,
          text: message.content,
          thread_ts: message.replyToId,
        });
      }

      this.logger.debug('Slack message sent', { channel });
    } catch (error) {
      this.logger.error('Failed to send Slack message', error);
      throw error;
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength * 0.5) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt === -1 || splitAt < maxLength * 0.5) {
        splitAt = maxLength;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  getApp(): App {
    return this.app;
  }
}

export function createSlackChannel(config: SlackConfig): SlackChannel {
  return new SlackChannel(config);
}
