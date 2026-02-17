export type {
  ForgePlugin,
  PluginManifest,
  PluginPermission,
  PluginStatus,
  PluginContext,
  PluginStorage,
  PluginLogger,
  PluginHooks,
  InboundMessage,
  OutboundMessage,
  MessageHookResult,
  ToolCallHookResult,
} from './types.js';

export { PluginManager, createPluginManager } from './manager.js';
export { FilePluginStorage } from './storage.js';

export { AutoResponderPlugin } from './builtin/auto-responder.js';
export { ContentFilterPlugin } from './builtin/content-filter.js';
export { ChatCommandsPlugin } from './builtin/chat-commands.js';

export { PluginSDK, createPluginSDK } from './sdk.js';
export type { PluginStoreEntry, PluginCategory, PluginConfigSchema } from './sdk.js';
