import type { ChannelType } from './session.js';

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  allowFrom?: string[];
  denyFrom?: string[];
  dmPolicy: 'pairing' | 'open' | 'closed';
  groupPolicy: 'mention' | 'always' | 'closed';
  rateLimit?: {
    windowMs: number;
    maxMessages: number;
  };
  metadata: Record<string, unknown>;
}

export interface InboundMessage {
  id: string;
  channelType: ChannelType;
  channelMessageId: string;
  senderId: string;
  senderName?: string;
  groupId?: string;
  groupName?: string;
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  timestamp: Date;
  raw: Record<string, unknown>;
}

export interface OutboundMessage {
  channelType: ChannelType;
  recipientId: string;
  groupId?: string;
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  format?: 'text' | 'markdown' | 'html';
}

export interface ChannelStatus {
  type: ChannelType;
  connected: boolean;
  lastActivity?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}
