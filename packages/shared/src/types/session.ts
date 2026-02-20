export type SessionStatus = 'active' | 'idle' | 'closed' | 'suspended';

export interface Session {
  id: string;
  userId: string;
  agentId: string;
  channelId: string;
  channelType: ChannelType;
  status: SessionStatus;
  sandboxed: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  tokenCount?: number;
  cost?: number;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  approved: boolean;
  executedAt?: Date;
}

export type ChannelType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'signal'
  | 'imessage'
  | 'teams'
  | 'googlechat'
  | 'matrix'
  | 'node'
  | 'webchat'
  | 'rest-api'
  | 'email'
  | 'cli';
