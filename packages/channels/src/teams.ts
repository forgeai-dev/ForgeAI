import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type TurnContext,
  MessageFactory,
  type Activity,
} from 'botbuilder';
import { generateId } from '@forgeai/shared';
import type { InboundMessage, OutboundMessage } from '@forgeai/shared';
import { BaseChannel } from './base.js';

export interface TeamsConfig {
  appId: string;
  appPassword: string;
  allowFrom?: string[];
  allowChannels?: string[];
  port?: number;
}

/**
 * Microsoft Teams channel using Bot Framework SDK v4.
 *
 * Setup:
 * 1. Register a bot in Azure Bot Service (https://portal.azure.com)
 * 2. Get the App ID and Password from the bot registration
 * 3. Configure the messaging endpoint to: https://your-domain/api/teams/messages
 * 4. Set TEAMS_APP_ID and TEAMS_APP_PASSWORD in your .env
 */
export class TeamsChannel extends BaseChannel {
  private adapter: CloudAdapter;
  private config: TeamsConfig;
  private allowedUsers: Set<string>;
  private allowedChannels: Set<string>;
  private conversationRefs: Map<string, Partial<Activity>> = new Map();

  constructor(config: TeamsConfig) {
    super('teams');
    this.config = config;
    this.allowedUsers = new Set(config.allowFrom ?? []);
    this.allowedChannels = new Set(config.allowChannels ?? []);

    const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
      MicrosoftAppType: 'MultiTenant',
    } as Record<string, string>);

    this.adapter = new CloudAdapter(botFrameworkAuth);

    // Error handler
    this.adapter.onTurnError = async (context: TurnContext, error: Error) => {
      this.logger.error('Teams adapter error', { error: error.message });
      try {
        await context.sendActivity('Ocorreu um erro ao processar sua mensagem.');
      } catch {
        // Ignore send errors during error handling
      }
    };
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.logger.info('Teams channel initialized', {
      appId: this.config.appId.substring(0, 8) + '...',
    });
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.conversationRefs.clear();
    this.logger.info('Teams channel disconnected');
  }

  /**
   * Process an incoming request from the Bot Framework.
   * This should be called from a Fastify route handler.
   */
  async processActivity(req: { body: unknown; headers: Record<string, string> }, res: { status: (code: number) => { send: (body?: unknown) => void } }): Promise<void> {
    try {
      // Create a mock request/response for the adapter
      const mockReq = {
        body: req.body,
        headers: req.headers,
        method: 'POST',
      };
      const mockRes = {
        status: (code: number) => {
          res.status(code).send();
          return mockRes;
        },
        send: (body?: unknown) => {
          if (body) res.status(200).send(body);
        },
        end: () => { res.status(200).send(); },
        setHeader: () => {},
        writeHead: () => mockRes,
        write: () => true,
      };

      await this.adapter.process(
        mockReq as any,
        mockRes as any,
        async (context: TurnContext) => {
          await this.handleTurn(context);
        },
      );
    } catch (error) {
      this.logger.error('Failed to process Teams activity', error);
      res.status(500).send({ error: 'Internal error' });
    }
  }

  private async handleTurn(context: TurnContext): Promise<void> {
    const activity = context.activity;

    // Only handle message activities
    if (activity.type !== 'message' || !activity.text) {
      // Handle conversation update (bot added to team/chat)
      if (activity.type === 'conversationUpdate' && activity.membersAdded) {
        for (const member of activity.membersAdded) {
          if (member.id !== activity.recipient.id) {
            this.logger.info('New member added to conversation', { memberId: member.id });
          }
        }
      }
      return;
    }

    const senderId = activity.from?.aadObjectId ?? activity.from?.id ?? '';
    const senderName = activity.from?.name ?? 'Unknown';
    const conversationId = activity.conversation?.id ?? '';
    const isGroup = activity.conversation?.isGroup === true ||
                    activity.conversation?.conversationType === 'channel' ||
                    activity.conversation?.conversationType === 'groupChat';

    // Store conversation reference for proactive messaging
    this.conversationRefs.set(conversationId, {
      ...context.activity,
    } as Partial<Activity>);

    // Allowlist check — users
    if (this.allowedUsers.size > 0 && !this.allowedUsers.has(senderId) && !this.allowedUsers.has('*')) {
      this.logger.warn('Message from non-allowed Teams user', { senderId, senderName });
      return;
    }

    // Allowlist check — channels
    if (isGroup && this.allowedChannels.size > 0 && !this.allowedChannels.has(conversationId) && !this.allowedChannels.has('*')) {
      this.logger.warn('Message from non-allowed Teams channel', { conversationId });
      return;
    }

    // Remove bot mention from text (Teams includes @mention in message text)
    let cleanText = activity.text ?? '';
    if (activity.entities) {
      for (const entity of activity.entities) {
        if (entity.type === 'mention' && (entity as any).mentioned?.id === activity.recipient.id) {
          const mentionText = (entity as any).text ?? '';
          cleanText = cleanText.replace(mentionText, '').trim();
        }
      }
    }

    if (!cleanText) return;

    const inbound: InboundMessage = {
      id: generateId('tmsg'),
      channelType: 'teams',
      channelMessageId: activity.id ?? '',
      senderId,
      senderName,
      groupId: isGroup ? conversationId : undefined,
      content: cleanText,
      replyToId: activity.replyToId,
      timestamp: activity.timestamp ? new Date(activity.timestamp) : new Date(),
      raw: activity as unknown as Record<string, unknown>,
    };

    this.logger.debug('Inbound Teams message', { senderId, senderName, isGroup, conversationId });

    // Send typing indicator
    await context.sendActivity({ type: 'typing' });

    await this.handleInbound(inbound);
  }

  async send(message: OutboundMessage): Promise<void> {
    const conversationId = message.groupId ?? message.recipientId;
    const ref = this.conversationRefs.get(conversationId);

    if (!ref) {
      this.logger.error('No conversation reference found for', { conversationId });
      throw new Error(`No conversation reference for ${conversationId}`);
    }

    try {
      if (message.content.length > 4000) {
        const chunks = this.splitMessage(message.content, 4000);
        for (const chunk of chunks) {
          await this.adapter.continueConversationAsync(
            this.config.appId,
            ref as any,
            async (context: TurnContext) => {
              await context.sendActivity(MessageFactory.text(chunk));
            },
          );
        }
      } else {
        await this.adapter.continueConversationAsync(
          this.config.appId,
          ref as any,
          async (context: TurnContext) => {
            await context.sendActivity(MessageFactory.text(message.content));
          },
        );
      }

      this.logger.debug('Teams message sent', { conversationId });
    } catch (error) {
      this.logger.error('Failed to send Teams message', error);
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

  getAdapter(): CloudAdapter {
    return this.adapter;
  }
}

export function createTeamsChannel(config: TeamsConfig): TeamsChannel {
  return new TeamsChannel(config);
}
