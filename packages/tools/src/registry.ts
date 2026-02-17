import { createLogger } from '@forgeai/shared';
import type { BaseTool, ToolDefinition, ToolResult } from './base.js';
import { createAuditLogger, type AuditLogger } from '@forgeai/security';

const logger = createLogger('Tool:Registry');

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private auditLogger: AuditLogger;
  private blockedTools: Set<string> = new Set();

  constructor(auditLogger?: AuditLogger) {
    this.auditLogger = auditLogger ?? createAuditLogger();
  }

  register(tool: BaseTool): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    logger.info(`Tool registered: ${tool.name} [${tool.definition.category}]`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    logger.info(`Tool unregistered: ${name}`);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  listForLLM(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.definition.name,
        description: tool.definition.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            tool.definition.parameters.map(p => [p.name, {
              type: p.type,
              description: p.description,
            }])
          ),
          required: tool.definition.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  blockTool(name: string): void {
    this.blockedTools.add(name);
    logger.warn(`Tool blocked: ${name}`);
  }

  unblockTool(name: string): void {
    this.blockedTools.delete(name);
    logger.info(`Tool unblocked: ${name}`);
  }

  async execute(name: string, params: Record<string, unknown>, userId?: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}`, duration: 0 };
    }

    if (this.blockedTools.has(name)) {
      this.auditLogger.log({
        action: 'tool.blocked',
        userId,
        details: { tool: name, params },
        success: false,
        riskLevel: 'high',
      });
      return { success: false, error: `Tool ${name} is currently blocked`, duration: 0 };
    }

    if (tool.definition.dangerous) {
      this.auditLogger.log({
        action: 'tool.dangerous_call',
        userId,
        details: { tool: name, params },
        riskLevel: 'medium',
      });
    }

    try {
      const result = await tool.execute(params);

      this.auditLogger.log({
        action: 'tool.execute',
        userId,
        details: { tool: name, success: result.success, duration: result.duration },
        success: result.success,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool ${name} execution failed`, error);

      this.auditLogger.log({
        action: 'tool.execute',
        userId,
        details: { tool: name, error: errorMsg },
        success: false,
        riskLevel: 'medium',
      });

      return { success: false, error: errorMsg, duration: 0 };
    }
  }

  get size(): number {
    return this.tools.size;
  }
}

export function createToolRegistry(auditLogger?: AuditLogger): ToolRegistry {
  return new ToolRegistry(auditLogger);
}
