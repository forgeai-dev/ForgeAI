import type { ToolRegistry } from '@forgeai/tools';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  tags?: string[];
  permissions?: PluginPermission[];
}

export type PluginPermission =
  | 'tools.register'
  | 'tools.execute'
  | 'hooks.message'
  | 'hooks.startup'
  | 'hooks.shutdown'
  | 'api.register'
  | 'storage.read'
  | 'storage.write';

export type PluginStatus = 'registered' | 'active' | 'inactive' | 'error';

export interface PluginContext {
  pluginId: string;
  toolRegistry: ToolRegistry;
  storage: PluginStorage;
  logger: PluginLogger;
  config: Record<string, unknown>;
}

export interface PluginStorage {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface PluginHooks {
  onActivate?(ctx: PluginContext): Promise<void>;
  onDeactivate?(ctx: PluginContext): Promise<void>;
  onMessage?(ctx: PluginContext, message: InboundMessage): Promise<MessageHookResult>;
  onResponse?(ctx: PluginContext, response: OutboundMessage): Promise<OutboundMessage>;
  onToolCall?(ctx: PluginContext, toolName: string, params: Record<string, unknown>): Promise<ToolCallHookResult>;
}

export interface InboundMessage {
  content: string;
  userId: string;
  sessionId: string;
  channelType: string;
}

export interface OutboundMessage {
  content: string;
  model?: string;
  provider?: string;
}

export interface MessageHookResult {
  handled: boolean;
  response?: string;
  modified?: string;
}

export interface ToolCallHookResult {
  allowed: boolean;
  reason?: string;
  modifiedParams?: Record<string, unknown>;
}

export interface ForgePlugin extends PluginHooks {
  manifest: PluginManifest;
}
