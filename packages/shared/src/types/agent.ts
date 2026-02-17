export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  provider: LLMProvider;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools: string[];
  sandboxMode: SandboxMode;
  workspace?: string;
}

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'mistral' | 'groq' | 'deepseek' | 'moonshot' | 'xai' | 'local';

export type SandboxMode = 'always' | 'non-main' | 'never';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export interface LLMRequest {
  model: string;
  provider: LLMProvider;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  thinking?: ThinkingLevel;
  thinkingBudget?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** Base64-encoded image data for vision/multimodal requests */
  imageData?: { base64: string; mimeType: string };
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface LLMResponse {
  id: string;
  model: string;
  provider: LLMProvider;
  content: string;
  thinking?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    thinkingTokens?: number;
  };
  cost?: number;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export interface UsageRecord {
  id: string;
  sessionId: string;
  userId: string;
  provider: LLMProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thinkingTokens?: number;
  cost: number;
  durationMs: number;
  channelType?: string;
  createdAt: Date;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
  byModel: Record<string, { requests: number; tokens: number; cost: number }>;
}

export interface ModelRoute {
  priority: number;
  provider: LLMProvider;
  model: string;
  maxCostPerMessage?: number;
  maxLatencyMs?: number;
  fallback?: boolean;
}

// ─── Multi-Agent Types ────────────────────────────

export interface MultiAgentConfig {
  agents: AgentDefinition[];
  bindings: AgentBinding[];
  agentToAgent?: AgentToAgentConfig;
}

export interface AgentDefinition {
  id: string;
  name: string;
  model?: string;
  provider?: LLMProvider;
  workspace?: string;
  systemPrompt?: string;
  persona?: string;
  temperature?: number;
  maxTokens?: number;
  default?: boolean;
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  sandboxMode?: SandboxMode;
}

export interface AgentBinding {
  agentId: string;
  match: {
    channel?: string;
    accountId?: string;
    peer?: { kind: 'direct' | 'group'; id: string };
    sessionId?: string;
  };
}

export interface AgentToAgentConfig {
  enabled: boolean;
  allow?: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  model: string;
  provider: string;
  sessionCount: number;
  totalTokens: number;
  isDefault: boolean;
  createdAt: Date;
}
