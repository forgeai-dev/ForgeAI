import { createLogger } from '@forgeai/shared';

const logger = createLogger('Plugin:SDK');

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  homepage?: string;
  repository?: string;
  keywords: string[];
  permissions: PluginPermission[];
  config?: PluginConfigSchema[];
  hooks: PluginHookType[];
}

export type PluginPermission =
  | 'messages.read'
  | 'messages.write'
  | 'tools.execute'
  | 'tools.register'
  | 'sessions.read'
  | 'sessions.write'
  | 'vault.read'
  | 'vault.write'
  | 'webhooks.send'
  | 'webhooks.receive'
  | 'files.read'
  | 'files.write';

export type PluginHookType =
  | 'onMessage'
  | 'onResponse'
  | 'onToolCall'
  | 'onToolResult'
  | 'onSessionCreate'
  | 'onSessionEnd'
  | 'onError'
  | 'onStartup'
  | 'onShutdown';

export interface PluginConfigSchema {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface PluginStoreEntry {
  id: string;
  manifest: PluginManifest;
  installed: boolean;
  enabled: boolean;
  installedAt?: Date;
  rating?: number;
  downloads?: number;
  category: PluginCategory;
}

export type PluginCategory =
  | 'communication'
  | 'productivity'
  | 'security'
  | 'analytics'
  | 'integration'
  | 'automation'
  | 'utility';

export class PluginSDK {
  private store: Map<string, PluginStoreEntry> = new Map();

  constructor() {
    this.registerBuiltinPlugins();
    logger.info('Plugin SDK initialized');
  }

  private registerBuiltinPlugins(): void {
    const builtins: PluginStoreEntry[] = [
      {
        id: 'forgeai-auto-responder',
        manifest: {
          name: 'Auto Responder',
          version: '1.0.0',
          description: 'Automatic responses for common patterns like greetings, help, and farewell messages.',
          author: 'ForgeAI',
          license: 'MIT',
          keywords: ['auto', 'responder', 'greetings'],
          permissions: ['messages.read', 'messages.write'],
          hooks: ['onMessage'],
        },
        installed: true,
        enabled: true,
        installedAt: new Date(),
        rating: 4.5,
        downloads: 1000,
        category: 'communication',
      },
      {
        id: 'forgeai-content-filter',
        manifest: {
          name: 'Content Filter',
          version: '1.0.0',
          description: 'Filters messages for profanity, spam, and blocked keywords. Configurable block lists.',
          author: 'ForgeAI',
          license: 'MIT',
          keywords: ['filter', 'moderation', 'security'],
          permissions: ['messages.read', 'messages.write'],
          hooks: ['onMessage', 'onResponse'],
          config: [
            { key: 'blockedWords', type: 'string', label: 'Blocked Words', description: 'Comma-separated list of blocked words' },
            { key: 'blockProfanity', type: 'boolean', label: 'Block Profanity', default: true },
          ],
        },
        installed: true,
        enabled: true,
        installedAt: new Date(),
        rating: 4.8,
        downloads: 2500,
        category: 'security',
      },
      {
        id: 'forgeai-chat-commands',
        manifest: {
          name: 'Chat Commands',
          version: '1.0.0',
          description: 'Slash commands: /status, /new, /help, /tools, /plugins, /model, /workflows',
          author: 'ForgeAI',
          license: 'MIT',
          keywords: ['commands', 'slash', 'chat'],
          permissions: ['messages.read', 'messages.write', 'sessions.read', 'tools.execute'],
          hooks: ['onMessage'],
        },
        installed: true,
        enabled: true,
        installedAt: new Date(),
        rating: 4.7,
        downloads: 1800,
        category: 'utility',
      },
    ];

    for (const entry of builtins) {
      this.store.set(entry.id, entry);
    }
  }

  listPlugins(filter?: { category?: PluginCategory; installed?: boolean; enabled?: boolean }): PluginStoreEntry[] {
    let entries = Array.from(this.store.values());
    if (filter?.category) entries = entries.filter(e => e.category === filter.category);
    if (filter?.installed !== undefined) entries = entries.filter(e => e.installed === filter.installed);
    if (filter?.enabled !== undefined) entries = entries.filter(e => e.enabled === filter.enabled);
    return entries;
  }

  getPlugin(id: string): PluginStoreEntry | undefined {
    return this.store.get(id);
  }

  installPlugin(manifest: PluginManifest, category: PluginCategory = 'utility'): PluginStoreEntry {
    const id = manifest.name.toLowerCase().replace(/\s+/g, '-');
    const entry: PluginStoreEntry = {
      id,
      manifest,
      installed: true,
      enabled: false,
      installedAt: new Date(),
      category,
    };
    this.store.set(id, entry);
    logger.info('Plugin installed', { id, name: manifest.name });
    return entry;
  }

  uninstallPlugin(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;
    entry.installed = false;
    entry.enabled = false;
    logger.info('Plugin uninstalled', { id });
    return true;
  }

  enablePlugin(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry || !entry.installed) return false;
    entry.enabled = true;
    return true;
  }

  disablePlugin(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;
    entry.enabled = false;
    return true;
  }

  validateManifest(manifest: PluginManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.name) errors.push('name is required');
    if (!manifest.version) errors.push('version is required');
    if (!manifest.description) errors.push('description is required');
    if (!manifest.author) errors.push('author is required');
    if (!manifest.license) errors.push('license is required');
    if (!manifest.hooks || manifest.hooks.length === 0) errors.push('at least one hook is required');
    if (!manifest.permissions) errors.push('permissions array is required');

    const validHooks: PluginHookType[] = ['onMessage', 'onResponse', 'onToolCall', 'onToolResult', 'onSessionCreate', 'onSessionEnd', 'onError', 'onStartup', 'onShutdown'];
    for (const hook of manifest.hooks ?? []) {
      if (!validHooks.includes(hook)) errors.push(`invalid hook: ${hook}`);
    }

    return { valid: errors.length === 0, errors };
  }

  getCategories(): { category: PluginCategory; count: number }[] {
    const map = new Map<PluginCategory, number>();
    for (const entry of this.store.values()) {
      map.set(entry.category, (map.get(entry.category) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([category, count]) => ({ category, count }));
  }

  generatePluginTemplate(name: string): string {
    const className = name.replace(/[^a-zA-Z0-9]/g, '');
    return `import type { PluginContext, InboundMessage, OutboundMessage } from '@forgeai/plugins';

export class ${className}Plugin {
  static readonly manifest = {
    name: '${name}',
    version: '1.0.0',
    description: 'A custom ForgeAI plugin',
    author: 'Your Name',
    license: 'MIT',
    keywords: ['custom'],
    permissions: ['messages.read'],
    hooks: ['onMessage'] as const,
  };

  async onMessage(message: InboundMessage, context: PluginContext): Promise<InboundMessage | null> {
    // Process the message before it reaches the agent
    // Return null to block the message, or modified message to continue
    return message;
  }

  async onResponse(response: OutboundMessage, context: PluginContext): Promise<OutboundMessage | null> {
    // Process the response before it's sent to the user
    return response;
  }
}
`;
  }
}

export function createPluginSDK(): PluginSDK {
  return new PluginSDK();
}
