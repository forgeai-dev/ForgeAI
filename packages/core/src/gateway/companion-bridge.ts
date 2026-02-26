/**
 * CompanionBridge — delegates agent tool calls to connected Companion apps
 * via WebSocket for local execution on the user's machine (Windows/Mac/Linux).
 *
 * Flow:
 * 1. Companion connects via WS with companionId
 * 2. Agent calls a tool (e.g. shell_exec) during processMessage
 * 3. CompanionBridge sends { type: "action_request", requestId, action, params } via WS
 * 4. Companion executes locally, sends back { type: "action_result", requestId, result }
 * 5. Bridge resolves the Promise, agent continues with the result
 */

import { createLogger, generateId } from '@forgeai/shared';
import type { ToolExecutor } from '@forgeai/agent';

const logger = createLogger('Core:CompanionBridge');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WSSocket = any;

interface PendingRequest {
  resolve: (result: { success: boolean; output: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CompanionConnection {
  socket: WSSocket;
  companionId: string;
  connectedAt: number;
}

const ACTION_TIMEOUT_MS = 120_000; // 2 minutes — some commands take time

// ─── Tool name → Companion action mapping ───
// These server-side tools get delegated to the Companion for local execution
const DELEGATED_TOOLS: Record<string, string> = {
  'shell_exec': 'shell',
  'file_manager': 'file_manager',
  'desktop': 'desktop',
};

export class CompanionBridge {
  private connections: Map<string, CompanionConnection> = new Map();
  private pending: Map<string, PendingRequest> = new Map();

  /**
   * Register a Companion WebSocket connection.
   */
  registerCompanion(companionId: string, socket: WSSocket): void {
    // Close previous connection if exists
    const existing = this.connections.get(companionId);
    if (existing) {
      logger.info('Companion reconnected, closing previous', { companionId });
    }

    this.connections.set(companionId, {
      socket,
      companionId,
      connectedAt: Date.now(),
    });

    logger.info('Companion registered', { companionId, total: this.connections.size });
  }

  /**
   * Unregister a Companion WebSocket connection.
   */
  unregisterCompanion(companionId: string): void {
    this.connections.delete(companionId);
    logger.info('Companion unregistered', { companionId, total: this.connections.size });
  }

  /**
   * Check if a companion is connected.
   */
  isConnected(companionId: string): boolean {
    const conn = this.connections.get(companionId);
    return !!conn && conn.socket.readyState === 1;
  }

  /**
   * Handle an action_result message from a Companion.
   */
  handleActionResult(requestId: string, result: { success: boolean; output: string }): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      logger.warn('Received action_result for unknown request', { requestId });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(result);
    logger.debug('Action result received', { requestId, success: result.success });
  }

  /**
   * Send an action request to a Companion and wait for the result.
   */
  async requestAction(
    companionId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string }> {
    const conn = this.connections.get(companionId);
    if (!conn || conn.socket.readyState !== 1) {
      return { success: false, output: 'Companion is not connected' };
    }

    const requestId = generateId('creq');

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ success: false, output: `Companion action timed out after ${ACTION_TIMEOUT_MS / 1000}s` });
      }, ACTION_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, timer });

      const message = JSON.stringify({
        type: 'action_request',
        requestId,
        action,
        params,
      });

      try {
        conn.socket.send(message);
        logger.info('Action request sent to Companion', { companionId, requestId, action });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ success: false, output: `Failed to send action to Companion: ${err}` });
      }
    });
  }

  /**
   * Check if a tool should be delegated to the Companion.
   */
  static isDelegatedTool(toolName: string): boolean {
    return toolName in DELEGATED_TOOLS;
  }

  /**
   * Map server tool call to Companion action request.
   */
  static mapToolToAction(toolName: string, params: Record<string, unknown>): { action: string; params: Record<string, unknown> } {
    switch (toolName) {
      case 'shell_exec':
        return {
          action: 'shell',
          params: {
            command: params['command'],
            cwd: params['cwd'],
          },
        };

      case 'file_manager': {
        // file_manager tool has an 'operation' param that maps to local_actions
        const op = String(params['operation'] || 'read_file');
        return {
          action: op,
          params: {
            path: params['path'],
            content: params['content'],
            destination: params['destination'],
          },
        };
      }

      case 'desktop': {
        return {
          action: 'desktop',
          params: {
            action: params['action'],
            target: params['target'],
            text: params['text'],
            x: params['x'],
            y: params['y'],
            button: params['button'],
            delay: params['delay'],
          },
        };
      }

      default:
        return { action: toolName, params };
    }
  }
}

/**
 * CompanionToolExecutor — wraps the regular ToolExecutor.
 * For delegated tools (shell, file, desktop), sends to Companion via WS.
 * For everything else (web_browser, web_search, etc.), uses server tools.
 */
export class CompanionToolExecutor implements ToolExecutor {
  private inner: ToolExecutor;
  private bridge: CompanionBridge;
  private companionId: string;

  constructor(inner: ToolExecutor, bridge: CompanionBridge, companionId: string) {
    this.inner = inner;
    this.bridge = bridge;
    this.companionId = companionId;
  }

  listForLLM() {
    return this.inner.listForLLM();
  }

  async execute(name: string, params: Record<string, unknown>, userId?: string) {
    // If this tool should be delegated AND the companion is connected, delegate
    if (CompanionBridge.isDelegatedTool(name) && this.bridge.isConnected(this.companionId)) {
      const mapped = CompanionBridge.mapToolToAction(name, params);

      logger.info(`Delegating ${name} to Companion`, { companionId: this.companionId, action: mapped.action });

      const result = await this.bridge.requestAction(this.companionId, mapped.action, mapped.params);

      return {
        success: result.success,
        data: {
          stdout: result.output,
          stderr: '',
          exitCode: result.success ? 0 : 1,
          delegatedTo: 'companion',
        },
        error: result.success ? undefined : result.output,
        duration: 0,
      };
    }

    // Otherwise, use server-side execution
    return this.inner.execute(name, params, userId);
  }
}

// ─── Singleton ───
let bridge: CompanionBridge | null = null;

export function getCompanionBridge(): CompanionBridge {
  if (!bridge) {
    bridge = new CompanionBridge();
  }
  return bridge;
}
