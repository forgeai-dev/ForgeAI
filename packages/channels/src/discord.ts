import { Client, GatewayIntentBits, Events, type Message as DiscordMessage } from 'discord.js';
import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export interface DiscordConfig {
  botToken: string;
  allowFrom?: string[];
  guilds?: string[];
  requireMention?: boolean;
}

export class DiscordChannel extends BaseChannel {
  private client: Client;
  private config: DiscordConfig;
  private allowedUsers: Set<string>;
  private allowedGuilds: Set<string>;
  private botUserId: string | null = null;

  constructor(config: DiscordConfig) {
    super('discord');
    this.config = config;
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedGuilds = new Set(config.guilds ?? []);

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.client.on(Events.MessageCreate, async (msg: DiscordMessage) => {
      // Ignore bot's own messages
      if (msg.author.id === this.botUserId) return;
      if (msg.author.bot) return;

      const isGuild = !!msg.guild;
      const senderId = msg.author.id;
      const senderName = msg.author.displayName || msg.author.username;

      // Guild allowlist check
      if (isGuild && this.allowedGuilds.size > 0 && !this.allowedGuilds.has('*')) {
        if (!this.allowedGuilds.has(msg.guild!.id)) return;
      }

      // User allowlist check
      if (this.allowedUsers.size > 0 && !this.allowedUsers.has('*')) {
        if (!this.allowedUsers.has(senderId)) {
          this.logger.warn('Message from non-allowed user', { senderId, senderName });
          return;
        }
      }

      // In guilds, require mention if configured
      if (isGuild && this.config.requireMention) {
        const isMentioned = msg.mentions.users.has(this.botUserId!);
        if (!isMentioned) return;
      }

      // Strip bot mention from content
      let content = msg.content;
      if (this.botUserId) {
        content = content.replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '').trim();
      }

      if (!content) return;

      const inbound: InboundMessage = {
        id: generateId('dmsg'),
        channelType: 'discord',
        channelMessageId: msg.id,
        senderId,
        senderName,
        groupId: isGuild ? msg.channelId : undefined,
        groupName: isGuild ? (msg.channel as { name?: string }).name : undefined,
        content,
        replyToId: msg.reference?.messageId ?? undefined,
        timestamp: msg.createdAt,
        raw: {
          guildId: msg.guild?.id,
          channelId: msg.channelId,
          authorId: msg.author.id,
        },
      };

      this.logger.debug('Inbound message', { senderId, senderName, isGuild });
      await this.handleInbound(inbound);
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord client error', error);
    });
  }

  async connect(): Promise<void> {
    this.logger.info('Connecting Discord bot...');

    try {
      await this.client.login(this.config.botToken);

      this.botUserId = this.client.user?.id ?? null;
      this.logger.info(`Discord bot connected: ${this.client.user?.username}#${this.client.user?.discriminator}`);
      this._connected = true;
    } catch (error) {
      this.logger.error('Failed to connect Discord bot', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting Discord bot...');
    await this.client.destroy();
    this._connected = false;
    this.logger.info('Discord bot disconnected');
  }

  async send(message: OutboundMessage): Promise<void> {
    const channelId = message.groupId ?? message.recipientId;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) {
        throw new Error(`Channel ${channelId} not found or not text-based`);
      }

      const textChannel = channel as { send: (opts: Record<string, unknown>) => Promise<unknown> };

      if (message.content.length > 2000) {
        const chunks = this.splitMessage(message.content, 2000);
        for (const chunk of chunks) {
          await textChannel.send({
            content: chunk,
            reply: message.replyToId ? { messageReference: message.replyToId } : undefined,
          });
        }
      } else {
        await textChannel.send({
          content: message.content,
          reply: message.replyToId ? { messageReference: message.replyToId } : undefined,
        });
      }

      this.logger.debug('Message sent', { channelId });
    } catch (error) {
      this.logger.error('Failed to send message', error, { channelId });
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

  getClient(): Client {
    return this.client;
  }
}

export function createDiscordChannel(config: DiscordConfig): DiscordChannel {
  return new DiscordChannel(config);
}
