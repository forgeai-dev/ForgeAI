import { createLogger } from '@forgeai/shared';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'browser' | 'file' | 'scheduler' | 'code' | 'knowledge' | 'utility' | 'automation';
  parameters: ToolParameter[];
  dangerous?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

export abstract class BaseTool {
  abstract readonly definition: ToolDefinition;
  protected logger;

  constructor() {
    this.logger = createLogger(`Tool:${this.constructor.name}`);
  }

  get name(): string {
    return this.definition.name;
  }

  abstract execute(params: Record<string, unknown>): Promise<ToolResult>;

  protected validateParams(params: Record<string, unknown>): string | null {
    for (const param of this.definition.parameters) {
      if (param.required && !(param.name in params)) {
        return `Missing required parameter: ${param.name}`;
      }
    }
    return null;
  }

  protected timed<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    return fn().then(result => ({ result, duration: Date.now() - start }));
  }
}
