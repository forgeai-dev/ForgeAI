import { createContext, runInContext, type Context } from 'node:vm';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT_LENGTH = 50_000;

export class CodeRunnerTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'code_run',
    description: 'Execute JavaScript code in a sandboxed VM context. No filesystem, network, or process access. Returns console output and the final expression value.',
    category: 'code',
    dangerous: true,
    parameters: [
      { name: 'code', type: 'string', description: 'JavaScript code to execute', required: true },
      { name: 'timeout', type: 'number', description: 'Execution timeout in ms (max 5000)', required: false, default: 5000 },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const code = String(params['code']);
    const timeout = Math.min(Number(params['timeout']) || TIMEOUT_MS, TIMEOUT_MS);

    const { result, duration } = await this.timed(async () => {
      const output: string[] = [];

      const sandbox: Context = createContext({
        console: {
          log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => output.push(`[ERROR] ${args.map(String).join(' ')}`),
          warn: (...args: unknown[]) => output.push(`[WARN] ${args.map(String).join(' ')}`),
          info: (...args: unknown[]) => output.push(`[INFO] ${args.map(String).join(' ')}`),
        },
        JSON,
        Math,
        Date,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        Array,
        Object,
        String: globalThis.String,
        Number: globalThis.Number,
        Boolean: globalThis.Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        Error,
        TypeError,
        RangeError,
        // Blocked: require, import, fetch, process, Buffer, fs, child_process, etc.
      });

      try {
        const result = runInContext(code, sandbox, {
          timeout,
          displayErrors: true,
        });

        const outputStr = output.join('\n').slice(0, MAX_OUTPUT_LENGTH);
        const resultStr = result !== undefined ? String(result) : undefined;

        return {
          output: outputStr,
          result: resultStr?.slice(0, MAX_OUTPUT_LENGTH),
          truncated: outputStr.length >= MAX_OUTPUT_LENGTH,
        };
      } catch (error) {
        const outputStr = output.join('\n').slice(0, MAX_OUTPUT_LENGTH);
        const errorMsg = error instanceof Error ? error.message : String(error);

        return {
          output: outputStr,
          error: errorMsg,
        };
      }
    });

    const data = result as { error?: string; output?: string; result?: string };
    if (data.error) {
      this.logger.debug('Code execution error', { error: data.error, duration });
      return { success: false, data, error: data.error, duration };
    }

    this.logger.debug('Code executed', { duration });
    return { success: true, data, duration };
  }
}
