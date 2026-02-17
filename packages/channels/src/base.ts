import type { ChannelType, InboundMessage, OutboundMessage, ChannelStatus } from '@forgeai/shared';
import { createLogger } from '@forgeai/shared';

export type MessageHandler = (message: InboundMessage) => Promise<void>;

export interface ChannelWithPermissions {
  addAllowedUser(userId: string): void;
  removeAllowedUser(userId: string): void;
  addAllowedGroup(groupId: string): void;
  removeAllowedGroup(groupId: string): void;
  addAdmin(userId: string): void;
  removeAdmin(userId: string): void;
  getPermissions(): { allowedUsers: string[]; allowedGroups: string[]; adminUsers: string[] };
}

export abstract class BaseChannel {
  readonly type: ChannelType;
  protected logger;
  protected messageHandler: MessageHandler | null = null;
  protected _connected = false;

  constructor(type: ChannelType) {
    this.type = type;
    this.logger = createLogger(`Channel:${type}`);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: OutboundMessage): Promise<void>;

  isConnected(): boolean {
    return this._connected;
  }

  getStatus(): ChannelStatus {
    return {
      type: this.type,
      connected: this._connected,
    };
  }

  protected async handleInbound(message: InboundMessage): Promise<void> {
    if (!this.messageHandler) {
      this.logger.warn('No message handler registered, dropping message');
      return;
    }
    await this.messageHandler(message);
  }
}
