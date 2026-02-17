import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

/**
 * SessionTools — Agent-to-Agent communication tools.
 * - sessions_list: discover active sessions/agents
 * - sessions_history: fetch transcript of another session
 * - sessions_send: message another agent
 *
 * These tools require an AgentManager reference to be set after construction.
 */

// Minimal interface for AgentManager to avoid circular dependency
interface AgentManagerRef {
  listAgents(): Array<{
    id: string;
    name: string;
    model: string;
    provider: string;
    sessionCount: number;
    totalTokens: number;
    isDefault: boolean;
  }>;
  listAllSessions(): Array<{
    sessionId: string;
    messageCount: number;
    totalTokens: number;
    lastActivity: Date;
    agentId: string;
  }>;
  getHistoryMessages(sessionId: string): Array<{
    role: string;
    content: string;
    timestamp: Date;
  }>;
  agentSendMessage(params: {
    fromAgentId: string;
    toAgentId: string;
    content: string;
    replyBack?: boolean;
  }): Promise<{ content: string; model: string; duration: number } | null>;
  isAgentToAgentEnabled: boolean;
}

// Singleton ref — set by gateway at startup
let agentManagerRef: AgentManagerRef | null = null;

export function setAgentManagerRef(ref: AgentManagerRef): void {
  agentManagerRef = ref;
}

/**
 * sessions_list — List active agents and their sessions.
 */
export class SessionsListTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'sessions_list',
    description: 'List all available agents and their active sessions. Use this to discover other agents you can communicate with.',
    category: 'utility',
    parameters: [
      {
        name: 'includeHistory',
        type: 'boolean',
        description: 'If true, include session details for each agent',
        required: false,
        default: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();

    if (!agentManagerRef) {
      return { success: false, error: 'Agent manager not available', duration: Date.now() - start };
    }

    const agents = agentManagerRef.listAgents();
    const includeHistory = params['includeHistory'] === true;

    if (includeHistory) {
      const sessions = agentManagerRef.listAllSessions();
      return {
        success: true,
        data: {
          agents,
          sessions: sessions.map(s => ({
            sessionId: s.sessionId,
            agentId: s.agentId,
            messageCount: s.messageCount,
            totalTokens: s.totalTokens,
            lastActivity: s.lastActivity.toISOString(),
          })),
        },
        duration: Date.now() - start,
      };
    }

    return {
      success: true,
      data: { agents: agents.map(a => ({ id: a.id, name: a.name, model: a.model, sessions: a.sessionCount, default: a.isDefault })) },
      duration: Date.now() - start,
    };
  }
}

/**
 * sessions_history — Fetch conversation history for a specific session.
 */
export class SessionsHistoryTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'sessions_history',
    description: 'Fetch the conversation transcript of a specific session. Useful to understand what another agent has been working on.',
    category: 'utility',
    parameters: [
      {
        name: 'sessionId',
        type: 'string',
        description: 'The session ID to fetch history for',
        required: true,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of messages to return (default: 20)',
        required: false,
        default: 20,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();

    if (!agentManagerRef) {
      return { success: false, error: 'Agent manager not available', duration: Date.now() - start };
    }

    const sessionId = params['sessionId'] as string;
    if (!sessionId) {
      return { success: false, error: 'sessionId is required', duration: Date.now() - start };
    }

    const limit = (params['limit'] as number) ?? 20;
    const messages = agentManagerRef.getHistoryMessages(sessionId);
    const trimmed = messages.slice(-limit);

    return {
      success: true,
      data: {
        sessionId,
        totalMessages: messages.length,
        returned: trimmed.length,
        messages: trimmed.map(m => ({
          role: m.role,
          content: m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content,
          timestamp: m.timestamp.toISOString(),
        })),
      },
      duration: Date.now() - start,
    };
  }
}

/**
 * sessions_send — Send a message to another agent.
 */
export class SessionsSendTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'sessions_send',
    description: 'Send a message to another agent and get their response. Use this to delegate tasks or coordinate work across agents.',
    category: 'utility',
    parameters: [
      {
        name: 'toAgentId',
        type: 'string',
        description: 'The ID of the target agent to send the message to',
        required: true,
      },
      {
        name: 'message',
        type: 'string',
        description: 'The message content to send to the other agent',
        required: true,
      },
      {
        name: 'fromAgentId',
        type: 'string',
        description: 'Your agent ID (auto-detected if not provided)',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();

    if (!agentManagerRef) {
      return { success: false, error: 'Agent manager not available', duration: Date.now() - start };
    }

    if (!agentManagerRef.isAgentToAgentEnabled) {
      return { success: false, error: 'Agent-to-agent communication is disabled. Enable it in the multi-agent config.', duration: Date.now() - start };
    }

    const toAgentId = params['toAgentId'] as string;
    const message = params['message'] as string;
    const fromAgentId = (params['fromAgentId'] as string) ?? 'main';

    if (!toAgentId || !message) {
      return { success: false, error: 'toAgentId and message are required', duration: Date.now() - start };
    }

    try {
      const result = await agentManagerRef.agentSendMessage({
        fromAgentId,
        toAgentId,
        content: message,
      });

      if (!result) {
        return { success: false, error: 'Failed to send message (agent not found or not allowed)', duration: Date.now() - start };
      }

      return {
        success: true,
        data: {
          fromAgent: fromAgentId,
          toAgent: toAgentId,
          response: result.content,
          model: result.model,
          duration: result.duration,
        },
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: `Agent communication failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
}
