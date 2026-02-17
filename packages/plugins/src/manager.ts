import { createLogger } from '@forgeai/shared';
import { createAuditLogger, type AuditLogger } from '@forgeai/security';
import type { ToolRegistry } from '@forgeai/tools';
import type {
  ForgePlugin,
  PluginContext,
  PluginStatus,
  InboundMessage,
  OutboundMessage,
  MessageHookResult,
  ToolCallHookResult,
} from './types.js';
import { FilePluginStorage } from './storage.js';

const logger = createLogger('Plugin:Manager');

interface PluginEntry {
  plugin: ForgePlugin;
  status: PluginStatus;
  context: PluginContext;
  activatedAt?: Date;
  error?: string;
}

export class PluginManager {
  private plugins: Map<string, PluginEntry> = new Map();
  private toolRegistry: ToolRegistry;
  private auditLogger: AuditLogger;

  constructor(toolRegistry: ToolRegistry, auditLogger?: AuditLogger) {
    this.toolRegistry = toolRegistry;
    this.auditLogger = auditLogger ?? createAuditLogger();
  }

  register(plugin: ForgePlugin, config?: Record<string, unknown>): void {
    const id = plugin.manifest.id;

    if (this.plugins.has(id)) {
      logger.warn(`Plugin ${id} already registered, overwriting`);
    }

    const storage = new FilePluginStorage(id);
    const pluginLogger = {
      info: (msg: string, ...args: unknown[]) => logger.info(`[${id}] ${msg}`, args.length ? { args } : undefined),
      warn: (msg: string, ...args: unknown[]) => logger.warn(`[${id}] ${msg}`, args.length ? { args } : undefined),
      error: (msg: string, ...args: unknown[]) => logger.error(`[${id}] ${msg}`, args.length ? { args } : undefined),
      debug: (msg: string, ...args: unknown[]) => logger.debug(`[${id}] ${msg}`, args.length ? { args } : undefined),
    };

    const context: PluginContext = {
      pluginId: id,
      toolRegistry: this.toolRegistry,
      storage,
      logger: pluginLogger,
      config: config ?? {},
    };

    this.plugins.set(id, {
      plugin,
      status: 'registered',
      context,
    });

    logger.info(`Plugin registered: ${plugin.manifest.name} v${plugin.manifest.version}`);
  }

  async activate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

    if (entry.status === 'active') {
      logger.warn(`Plugin ${pluginId} already active`);
      return;
    }

    try {
      if (entry.plugin.onActivate) {
        await entry.plugin.onActivate(entry.context);
      }
      entry.status = 'active';
      entry.activatedAt = new Date();
      entry.error = undefined;

      this.auditLogger.log({
        action: 'config.update',
        details: { type: 'plugin.activate', pluginId, name: entry.plugin.manifest.name },
        success: true,
      });

      logger.info(`Plugin activated: ${pluginId}`);
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
      logger.error(`Plugin activation failed: ${pluginId}`, error);
      throw error;
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

    if (entry.status !== 'active') return;

    try {
      if (entry.plugin.onDeactivate) {
        await entry.plugin.onDeactivate(entry.context);
      }
      entry.status = 'inactive';

      this.auditLogger.log({
        action: 'config.update',
        details: { type: 'plugin.deactivate', pluginId },
        success: true,
      });

      logger.info(`Plugin deactivated: ${pluginId}`);
    } catch (error) {
      logger.error(`Plugin deactivation failed: ${pluginId}`, error);
    }
  }

  async activateAll(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      if (entry.status === 'registered' || entry.status === 'inactive') {
        try {
          await this.activate(id);
        } catch {
          // Already logged in activate()
        }
      }
    }
  }

  async deactivateAll(): Promise<void> {
    for (const [id] of this.plugins) {
      await this.deactivate(id);
    }
  }

  async runMessageHooks(message: InboundMessage): Promise<MessageHookResult> {
    for (const [, entry] of this.plugins) {
      if (entry.status !== 'active' || !entry.plugin.onMessage) continue;

      try {
        const result = await entry.plugin.onMessage(entry.context, message);
        if (result.handled) return result;
        if (result.modified) {
          message = { ...message, content: result.modified };
        }
      } catch (error) {
        logger.error(`Plugin message hook failed: ${entry.plugin.manifest.id}`, error);
      }
    }

    return { handled: false };
  }

  async runResponseHooks(response: OutboundMessage): Promise<OutboundMessage> {
    let current = response;

    for (const [, entry] of this.plugins) {
      if (entry.status !== 'active' || !entry.plugin.onResponse) continue;

      try {
        current = await entry.plugin.onResponse(entry.context, current);
      } catch (error) {
        logger.error(`Plugin response hook failed: ${entry.plugin.manifest.id}`, error);
      }
    }

    return current;
  }

  async runToolCallHooks(toolName: string, params: Record<string, unknown>): Promise<ToolCallHookResult> {
    for (const [, entry] of this.plugins) {
      if (entry.status !== 'active' || !entry.plugin.onToolCall) continue;

      try {
        const result = await entry.plugin.onToolCall(entry.context, toolName, params);
        if (!result.allowed) return result;
        if (result.modifiedParams) {
          params = { ...params, ...result.modifiedParams };
        }
      } catch (error) {
        logger.error(`Plugin tool call hook failed: ${entry.plugin.manifest.id}`, error);
      }
    }

    return { allowed: true };
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: PluginStatus;
    activatedAt?: string;
    error?: string;
  }> {
    return Array.from(this.plugins.values()).map(entry => ({
      id: entry.plugin.manifest.id,
      name: entry.plugin.manifest.name,
      version: entry.plugin.manifest.version,
      description: entry.plugin.manifest.description,
      status: entry.status,
      activatedAt: entry.activatedAt?.toISOString(),
      error: entry.error,
    }));
  }

  get(pluginId: string): PluginEntry | undefined {
    return this.plugins.get(pluginId);
  }

  get size(): number {
    return this.plugins.size;
  }

  get activeCount(): number {
    return Array.from(this.plugins.values()).filter(e => e.status === 'active').length;
  }
}

export function createPluginManager(toolRegistry: ToolRegistry, auditLogger?: AuditLogger): PluginManager {
  return new PluginManager(toolRegistry, auditLogger);
}
