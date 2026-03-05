import { createLogger, generateId } from '@forgeai/shared';
import type {
  AgentConfig,
  AgentDefinition,
  AgentBinding,
  MultiAgentConfig,
  AgentToAgentConfig,
  AgentInfo,
  LLMProvider,
} from '@forgeai/shared';
import { AgentRuntime, type ToolExecutor, type AgentResult, type SessionInfo, type AgentProgressEvent } from './runtime.js';
import { LLMRouter } from './router.js';
import { UsageTracker, createUsageTracker } from './usage-tracker.js';
import { MemoryManager } from './memory-manager.js';

const logger = createLogger('Agent:Manager');

// ─── Delegation History ────────────────────────────────

export interface DelegationRecord {
  id: string;
  role: string;
  task: string;
  result: string;
  model: string;
  provider: string;
  parentSessionId: string;
  status: 'completed' | 'failed';
  duration: number;
  steps: number;
  tokens: number;
  error?: string;
  createdAt: number;
  completedAt: number;
  source: 'delegate' | 'team';
}

const MAX_DELEGATION_HISTORY = 100;

/**
 * AgentManager — manages multiple AgentRuntime instances.
 * Multi-agent architecture:
 * - Each agent has its own workspace, model, system prompt, and tool permissions
 * - Bindings route inbound messages to the correct agent
 * - Session tools allow agent-to-agent communication
 */
export class AgentManager {
  private agents: Map<string, AgentRuntime> = new Map();
  private agentDefs: Map<string, AgentDefinition> = new Map();
  private bindings: AgentBinding[] = [];
  private agentToAgent: AgentToAgentConfig = { enabled: false };
  private defaultAgentId: string = 'main';
  private router: LLMRouter;
  private usageTracker: UsageTracker;
  private toolExecutor: ToolExecutor | null = null;
  private memoryManager: MemoryManager | null = null;
  private createdAt: Map<string, Date> = new Map();
  private delegationHistory: DelegationRecord[] = [];
  private progressBroadcaster: ((parentSessionId: string, event: AgentProgressEvent & { delegateId: string; delegateRole: string }) => void) | null = null;

  constructor(router: LLMRouter, usageTracker?: UsageTracker) {
    this.router = router;
    this.usageTracker = usageTracker ?? createUsageTracker();
    logger.info('AgentManager initialized');
  }

  /**
   * Set a callback to broadcast sub-agent progress events to the parent session (Phase 3).
   */
  setProgressBroadcaster(cb: (parentSessionId: string, event: AgentProgressEvent & { delegateId: string; delegateRole: string }) => void): void {
    this.progressBroadcaster = cb;
  }

  /**
   * Load multi-agent config and create all agent runtimes.
   */
  loadConfig(config: MultiAgentConfig): void {
    // Clear existing agents
    this.agents.clear();
    this.agentDefs.clear();
    this.bindings = config.bindings ?? [];
    this.agentToAgent = config.agentToAgent ?? { enabled: false };

    for (const def of config.agents) {
      this.addAgent(def);
    }

    // Set default agent
    const defaultAgent = config.agents.find((a: AgentDefinition) => a.default) ?? config.agents[0];
    if (defaultAgent) {
      this.defaultAgentId = defaultAgent.id;
    }

    logger.info(`Loaded ${config.agents.length} agents, ${this.bindings.length} bindings, default=${this.defaultAgentId}`);
  }

  /**
   * Add a single agent at runtime.
   */
  addAgent(def: AgentDefinition): AgentRuntime {
    const agentConfig: AgentConfig = {
      id: def.id,
      name: def.name,
      model: def.model ?? 'gpt-4o-mini',
      provider: (def.provider ?? 'openai') as LLMProvider,
      systemPrompt: this.buildAgentPrompt(def),
      temperature: def.temperature ?? 0.7,
      maxTokens: def.maxTokens ?? 4096,
      tools: def.tools?.allow ?? [],
      sandboxMode: def.sandboxMode ?? 'always',
      workspace: def.workspace,
    };

    const runtime = new AgentRuntime(agentConfig, this.router, this.usageTracker);

    // Attach tool executor with filtering if needed
    if (this.toolExecutor) {
      if (def.tools?.allow || def.tools?.deny) {
        runtime.setToolExecutor(new FilteredToolExecutor(this.toolExecutor, def.tools.allow, def.tools.deny));
      } else {
        runtime.setToolExecutor(this.toolExecutor);
      }
    }

    // Attach shared memory manager for cross-session memory
    if (this.memoryManager) {
      runtime.setMemoryManager(this.memoryManager);
    }

    this.agents.set(def.id, runtime);
    this.agentDefs.set(def.id, def);
    this.createdAt.set(def.id, new Date());

    logger.info(`Agent added: ${def.id} (${def.name})`, {
      model: agentConfig.model,
      provider: agentConfig.provider,
    });

    return runtime;
  }

  /**
   * Remove an agent.
   */
  removeAgent(agentId: string): boolean {
    if (agentId === this.defaultAgentId) {
      logger.warn('Cannot remove default agent');
      return false;
    }
    const removed = this.agents.delete(agentId);
    this.agentDefs.delete(agentId);
    this.createdAt.delete(agentId);
    // Remove associated bindings
    this.bindings = this.bindings.filter(b => b.agentId !== agentId);
    if (removed) logger.info(`Agent removed: ${agentId}`);
    return removed;
  }

  /**
   * Get agent runtime by ID.
   */
  getAgent(agentId: string): AgentRuntime | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get the default agent.
   */
  getDefaultAgent(): AgentRuntime | undefined {
    return this.agents.get(this.defaultAgentId);
  }

  /**
   * Set memory manager for all agents (cross-session memory).
   */
  setMemoryManager(memory: MemoryManager): void {
    this.memoryManager = memory;
    for (const runtime of this.agents.values()) {
      runtime.setMemoryManager(memory);
    }
    logger.info('Memory manager set for all agents (cross-session memory enabled)');
  }

  /**
   * Set tool executor for all agents.
   */
  setToolExecutor(executor: ToolExecutor): void {
    // Wrap with cache layer so all agents share a dedup cache for expensive tools
    const cached = new CachedToolExecutor(executor);
    this.toolExecutor = cached;
    for (const [agentId, runtime] of this.agents) {
      const def = this.agentDefs.get(agentId);
      if (def?.tools?.allow || def?.tools?.deny) {
        runtime.setToolExecutor(new FilteredToolExecutor(cached, def.tools?.allow, def.tools?.deny));
      } else {
        runtime.setToolExecutor(cached);
      }
    }
    logger.info('Tool executor set for all agents (with shared result cache)');
  }

  /**
   * Route a message to the correct agent based on bindings.
   * Uses most-specific-wins strategy.
   */
  resolveAgent(params: {
    channel?: string;
    accountId?: string;
    peerId?: string;
    peerKind?: 'direct' | 'group';
    sessionId?: string;
  }): AgentRuntime {
    let bestMatch: AgentBinding | null = null;
    let bestScore = -1;

    for (const binding of this.bindings) {
      let score = 0;
      let matches = true;

      // Check each match field — all specified fields must match (AND semantics)
      if (binding.match.sessionId) {
        if (binding.match.sessionId === params.sessionId) score += 8;
        else matches = false;
      }
      if (binding.match.peer) {
        if (binding.match.peer.id === params.peerId && binding.match.peer.kind === params.peerKind) score += 4;
        else matches = false;
      }
      if (binding.match.accountId) {
        if (binding.match.accountId === params.accountId) score += 2;
        else matches = false;
      }
      if (binding.match.channel) {
        if (binding.match.channel === params.channel) score += 1;
        else matches = false;
      }

      if (matches && score > bestScore) {
        bestScore = score;
        bestMatch = binding;
      }
    }

    if (bestMatch) {
      const agent = this.agents.get(bestMatch.agentId);
      if (agent) return agent;
    }

    // Fallback to default
    return this.agents.get(this.defaultAgentId) ?? this.agents.values().next().value!;
  }

  /**
   * Process a message through the correct agent (routing + execution).
   */
  async processMessage(params: {
    sessionId: string;
    userId: string;
    content: string;
    channelType?: string;
    agentId?: string;
    image?: { base64: string; mimeType: string };
    modelOverride?: string;
    providerOverride?: string;
  }): Promise<AgentResult & { agentId: string }> {
    // If agentId specified, use it directly; otherwise route
    let agent: AgentRuntime | undefined;
    let resolvedAgentId: string;

    if (params.agentId) {
      agent = this.agents.get(params.agentId);
      resolvedAgentId = params.agentId;
    } else {
      agent = this.resolveAgent({
        channel: params.channelType,
        sessionId: params.sessionId,
      });
      resolvedAgentId = this.getAgentId(agent) ?? this.defaultAgentId;
    }

    if (!agent) {
      agent = this.getDefaultAgent()!;
      resolvedAgentId = this.defaultAgentId;
    }

    const result = await agent.processMessage({
      sessionId: params.sessionId,
      userId: params.userId,
      content: params.content,
      channelType: params.channelType,
      image: params.image,
      modelOverride: params.modelOverride,
      providerOverride: params.providerOverride,
    });

    return { ...result, agentId: resolvedAgentId };
  }

  /**
   * Get agentId for a given runtime instance.
   */
  private getAgentId(runtime: AgentRuntime): string | undefined {
    for (const [id, r] of this.agents) {
      if (r === runtime) return id;
    }
    return undefined;
  }

  /**
   * List all agents with info.
   */
  listAgents(): AgentInfo[] {
    const result: AgentInfo[] = [];
    for (const [id, runtime] of this.agents) {
      const config = runtime.getConfig();
      const sessions = runtime.listSessions();
      result.push({
        id,
        name: this.agentDefs.get(id)?.name ?? id,
        model: config.model,
        provider: config.provider,
        sessionCount: sessions.length,
        totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
        isDefault: id === this.defaultAgentId,
        createdAt: this.createdAt.get(id) ?? new Date(),
      });
    }
    return result;
  }

  /**
   * Get all sessions across all agents.
   */
  listAllSessions(): Array<SessionInfo & { agentId: string }> {
    const result: Array<SessionInfo & { agentId: string }> = [];
    for (const [id, runtime] of this.agents) {
      for (const session of runtime.listSessions()) {
        result.push({ ...session, agentId: id });
      }
    }
    return result.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  /**
   * Agent-to-agent: send a message from one agent's session to another agent.
   */
  async agentSendMessage(params: {
    fromAgentId: string;
    toAgentId: string;
    content: string;
    replyBack?: boolean;
  }): Promise<AgentResult | null> {
    if (!this.agentToAgent.enabled) {
      logger.warn('Agent-to-agent messaging is disabled');
      return null;
    }

    // Check allow list
    if (this.agentToAgent.allow && this.agentToAgent.allow.length > 0) {
      if (!this.agentToAgent.allow.includes(params.fromAgentId) || !this.agentToAgent.allow.includes(params.toAgentId)) {
        logger.warn(`Agent-to-agent blocked: ${params.fromAgentId} → ${params.toAgentId} not in allow list`);
        return null;
      }
    }

    const targetAgent = this.agents.get(params.toAgentId);
    if (!targetAgent) {
      logger.warn(`Target agent not found: ${params.toAgentId}`);
      return null;
    }

    const sessionId = `a2a-${params.fromAgentId}-${params.toAgentId}-${generateId('sess')}`;

    logger.info(`Agent-to-agent: ${params.fromAgentId} → ${params.toAgentId}`, { content: params.content.substring(0, 100) });

    const result = await targetAgent.processMessage({
      sessionId,
      userId: `agent:${params.fromAgentId}`,
      content: params.content,
      channelType: 'agent-to-agent',
    });

    return result;
  }

  /**
   * Update agent config at runtime.
   */
  updateAgent(agentId: string, updates: { model?: string; provider?: string; name?: string; persona?: string }): boolean {
    const runtime = this.agents.get(agentId);
    const def = this.agentDefs.get(agentId);
    if (!runtime || !def) return false;

    if (updates.model || updates.provider) {
      runtime.updateConfig({ model: updates.model, provider: updates.provider });
      if (updates.model) def.model = updates.model;
      if (updates.provider) def.provider = updates.provider as any;
    }
    if (updates.name) def.name = updates.name;
    if (updates.persona) def.persona = updates.persona;

    return true;
  }

  /**
   * Get all agent definitions (for persistence).
   */
  getAgentDefs(): AgentDefinition[] {
    return Array.from(this.agentDefs.values());
  }

  /**
   * Add a binding at runtime.
   */
  addBinding(binding: AgentBinding): void {
    this.bindings.push(binding);
    logger.info(`Binding added: ${binding.agentId}`, { match: binding.match });
  }

  /**
   * Remove bindings for an agent.
   */
  removeBindings(agentId: string): number {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter(b => b.agentId !== agentId);
    return before - this.bindings.length;
  }

  /**
   * Get bindings list.
   */
  getBindings(): AgentBinding[] {
    return [...this.bindings];
  }

  /**
   * Get progress for a session from the correct agent.
   */
  getProgress(sessionId: string): ReturnType<AgentRuntime['getProgress']> {
    for (const runtime of this.agents.values()) {
      const progress = runtime.getProgress(sessionId);
      if (progress) return progress;
    }
    return null;
  }

  /**
   * Get all active (currently processing) sessions across all agents.
   */
  getActiveSessions(): Array<{ agentId: string; sessionId: string; status: string; iteration: number; maxIterations: number; currentTool?: string; steps: unknown[]; startedAt: number }> {
    const result: Array<{ agentId: string; sessionId: string; status: string; iteration: number; maxIterations: number; currentTool?: string; steps: unknown[]; startedAt: number }> = [];
    for (const [agentId, runtime] of this.agents) {
      for (const progress of runtime.getActiveSessions()) {
        result.push({
          agentId,
          sessionId: progress.sessionId,
          status: progress.status,
          iteration: progress.iteration,
          maxIterations: progress.maxIterations,
          currentTool: progress.currentTool,
          steps: progress.steps,
          startedAt: progress.startedAt,
        });
      }
    }
    return result;
  }

  /**
   * Get history messages from the correct agent.
   */
  getHistoryMessages(sessionId: string): ReturnType<AgentRuntime['getHistoryMessages']> {
    for (const runtime of this.agents.values()) {
      const msgs = runtime.getHistoryMessages(sessionId);
      if (msgs.length > 0) return msgs;
    }
    return [];
  }

  /**
   * Get session info from any agent.
   */
  getSessionInfo(sessionId: string): (SessionInfo & { agentId: string }) | null {
    for (const [id, runtime] of this.agents) {
      const info = runtime.getSessionInfo(sessionId);
      if (info) return { ...info, agentId: id };
    }
    return null;
  }

  /**
   * Clear session in any agent.
   */
  clearSession(sessionId: string): boolean {
    for (const runtime of this.agents.values()) {
      const info = runtime.getSessionInfo(sessionId);
      if (info) {
        runtime.clearSession(sessionId);
        return true;
      }
    }
    return false;
  }

  /**
   * Abort a running session in any agent.
   */
  abortSession(sessionId: string): boolean {
    for (const runtime of this.agents.values()) {
      if (runtime.abortSession(sessionId)) return true;
    }
    return false;
  }

  /**
   * Build agent-specific system prompt.
   */
  private buildAgentPrompt(def: AgentDefinition): string | undefined {
    if (def.systemPrompt) return def.systemPrompt;
    if (!def.persona) return undefined;

    // If persona is defined, prepend it to the default prompt
    return `You are "${def.name}". ${def.persona}`;
  }

  get size(): number {
    return this.agents.size;
  }

  get defaultId(): string {
    return this.defaultAgentId;
  }

  get isAgentToAgentEnabled(): boolean {
    return this.agentToAgent.enabled;
  }

  /**
   * Delegate a task to a temporary specialist sub-agent.
   * The sub-agent gets the full default system prompt (all tool descriptions, proxy awareness, etc.)
   * but with agent_delegate denied to prevent recursive delegation.
   * It runs processMessage independently and returns the result.
   */
  async delegateTask(params: {
    role: string;
    task: string;
    context?: string;
    parentSessionId: string;
  }): Promise<{
    success: boolean;
    content: string;
    role: string;
    model: string;
    duration: number;
    steps: number;
    tokens?: number;
    error?: string;
  }> {
    const start = Date.now();
    const delegateId = `delegate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Use parent agent's model/provider
    const defaultAgent = this.getDefaultAgent();
    const parentConfig = defaultAgent?.getConfig();

    // Build the focused task message (this is what the sub-agent receives as "user" input)
    const taskMessage = [
      `## Your Role: ${params.role}`,
      '',
      '## Task',
      params.task,
      params.context ? `\n## Context\n${params.context}` : '',
      '',
      '## Rules',
      '- Complete this task thoroughly. You have access to ALL tools.',
      '- Verify your work actually works (browse URLs, check files exist).',
      '- Use CDN for any frontend libraries (you run behind a proxy).',
      '- Provide a clear summary of what you accomplished and any file paths created.',
      '- Do NOT delegate to other agents — you must complete this yourself.',
    ].filter(Boolean).join('\n');

    // Create temp agent definition — NO custom systemPrompt so it gets the full default
    // with all tool descriptions, proxy awareness, environment detection, etc.
    const def: AgentDefinition = {
      id: delegateId,
      name: params.role,
      model: parentConfig?.model ?? 'gpt-4o-mini',
      provider: (parentConfig?.provider ?? 'openai') as LLMProvider,
      temperature: 0.5,
      maxTokens: 4096,
      tools: { deny: ['agent_delegate'] }, // Prevent recursive delegation
    };

    logger.info(`Delegating to "${params.role}"`, {
      delegateId,
      model: def.model,
      task: params.task.substring(0, 120),
    });

    const runtime = this.addAgent(def);
    const sessionId = `deleg-${delegateId}`;

    // Copy planContextProvider from parent if available
    if (defaultAgent && (defaultAgent as any).planContextProvider) {
      runtime.setPlanContextProvider((defaultAgent as any).planContextProvider);
    }

    // Phase 3: Register progress listener to stream sub-agent events to parent session
    if (this.progressBroadcaster) {
      const broadcaster = this.progressBroadcaster;
      const parentSid = params.parentSessionId;
      const role = params.role;
      const dId = delegateId;
      runtime.onProgress(sessionId, (event) => {
        try {
          broadcaster(parentSid, { ...event, type: `delegate.${event.type}` as any, delegateId: dId, delegateRole: role });
        } catch { /* ignore broadcast errors */ }
      });
    }

    // Track result for delegation history
    let delegateResult = '';
    let delegateStatus!: 'completed' | 'failed';
    let delegateSteps = 0;
    let delegateTokens = 0;
    let delegateError: string | undefined;
    let delegateModel = def.model ?? 'unknown';

    try {
      const result = await runtime.processMessage({
        sessionId,
        userId: `delegate:${params.parentSessionId}`,
        content: taskMessage,
        channelType: 'delegation',
      });

      delegateResult = result.content.substring(0, 1000);
      delegateSteps = result.steps?.length ?? 0;
      delegateTokens = result.usage.totalTokens;
      delegateModel = result.model;
      delegateStatus = result.blocked ? 'failed' : 'completed';
      delegateError = result.blocked ? result.blockReason : undefined;

      logger.info(`Sub-agent "${params.role}" completed`, {
        delegateId,
        duration: Date.now() - start,
        steps: delegateSteps,
        tokens: delegateTokens,
      });

      return {
        success: !result.blocked,
        content: result.content,
        role: params.role,
        model: result.model,
        duration: Date.now() - start,
        steps: delegateSteps,
        tokens: delegateTokens,
        error: delegateError,
      };
    } catch (error) {
      delegateStatus = 'failed';
      delegateError = error instanceof Error ? error.message : String(error);
      logger.error(`Sub-agent "${params.role}" failed`, { delegateId, error });
      return {
        success: false,
        content: '',
        role: params.role,
        model: def.model ?? 'unknown',
        duration: Date.now() - start,
        steps: 0,
        error: delegateError,
      };
    } finally {
      // Save to delegation history before cleanup
      this.addDelegationRecord({
        id: delegateId,
        role: params.role,
        task: params.task.substring(0, 500),
        result: delegateResult,
        model: delegateModel,
        provider: (def.provider ?? 'openai') as string,
        parentSessionId: params.parentSessionId,
        status: delegateStatus,
        duration: Date.now() - start,
        steps: delegateSteps,
        tokens: delegateTokens,
        error: delegateError,
        createdAt: start,
        completedAt: Date.now(),
        source: 'delegate',
      });

      // Cleanup: remove temp agent runtime
      this.agents.delete(delegateId);
      this.agentDefs.delete(delegateId);
      this.createdAt.delete(delegateId);
      logger.info(`Sub-agent "${params.role}" saved to history & cleaned up`, { delegateId });
    }
  }

  // ─── Delegation History Management ────────────────────

  /**
   * Add a delegation record to history.
   */
  addDelegationRecord(record: DelegationRecord): void {
    this.delegationHistory.unshift(record);
    // Cap history size
    if (this.delegationHistory.length > MAX_DELEGATION_HISTORY) {
      this.delegationHistory = this.delegationHistory.slice(0, MAX_DELEGATION_HISTORY);
    }
  }

  /**
   * Get delegation history.
   */
  getDelegationHistory(): DelegationRecord[] {
    return this.delegationHistory;
  }

  /**
   * Remove a specific delegation record.
   */
  removeDelegation(id: string): boolean {
    const before = this.delegationHistory.length;
    this.delegationHistory = this.delegationHistory.filter(d => d.id !== id);
    return this.delegationHistory.length < before;
  }

  /**
   * Clear all delegation history.
   */
  clearDelegationHistory(): number {
    const count = this.delegationHistory.length;
    this.delegationHistory = [];
    return count;
  }
}

/**
 * CachedToolExecutor — wraps a ToolExecutor with a short-lived result cache.
 * Prevents duplicate tool calls (e.g. parent + sub-agent both calling web_browse on the same URL).
 * Only caches read-only/idempotent tools. Cache is global (shared across all agents).
 */
const CACHEABLE_TOOLS = new Set(['web_browse', 'web_search']);
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  result: { success: boolean; data?: unknown; error?: string; duration: number };
  cachedAt: number;
}

// Global cache shared across all agents in the same process
const globalToolCache = new Map<string, CacheEntry>();

// Periodic cleanup (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of globalToolCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS * 2) {
      globalToolCache.delete(key);
    }
  }
}, 60_000);

class CachedToolExecutor implements ToolExecutor {
  private inner: ToolExecutor;

  constructor(inner: ToolExecutor) {
    this.inner = inner;
  }

  listForLLM() {
    return this.inner.listForLLM();
  }

  async execute(name: string, params: Record<string, unknown>, userId?: string) {
    // Only cache idempotent read-only tools
    if (!CACHEABLE_TOOLS.has(name)) {
      return this.inner.execute(name, params, userId);
    }

    // Build cache key from tool name + sorted args (exclude internal fields)
    const cacheArgs = { ...params };
    delete cacheArgs['_sessionId'];
    const cacheKey = `${name}:${JSON.stringify(cacheArgs, Object.keys(cacheArgs).sort())}`;

    // Check cache
    const cached = globalToolCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      logger.info(`⚡ Cache hit for ${name} (${Math.round((Date.now() - cached.cachedAt) / 1000)}s old)`);
      return { ...cached.result, duration: 0 };
    }

    // Execute and cache
    const result = await this.inner.execute(name, params, userId);
    if (result.success) {
      globalToolCache.set(cacheKey, { result, cachedAt: Date.now() });
    }
    return result;
  }
}

/**
 * FilteredToolExecutor — wraps a ToolExecutor with allow/deny lists.
 */
class FilteredToolExecutor implements ToolExecutor {
  private inner: ToolExecutor;
  private allow?: string[];
  private deny?: string[];

  constructor(inner: ToolExecutor, allow?: string[], deny?: string[]) {
    this.inner = inner;
    this.allow = allow;
    this.deny = deny;
  }

  listForLLM() {
    let tools = this.inner.listForLLM();
    if (this.allow && this.allow.length > 0) {
      tools = tools.filter(t => this.allow!.includes(t.function.name));
    }
    if (this.deny && this.deny.length > 0) {
      tools = tools.filter(t => !this.deny!.includes(t.function.name));
    }
    return tools;
  }

  async execute(name: string, params: Record<string, unknown>, userId?: string) {
    // Check if tool is allowed
    if (this.allow && this.allow.length > 0 && !this.allow.includes(name)) {
      return { success: false, error: `Tool '${name}' is not in the allow list for this agent`, duration: 0 };
    }
    if (this.deny && this.deny.length > 0 && this.deny.includes(name)) {
      return { success: false, error: `Tool '${name}' is denied for this agent`, duration: 0 };
    }
    return this.inner.execute(name, params, userId);
  }
}

export function createAgentManager(router: LLMRouter, usageTracker?: UsageTracker): AgentManager {
  return new AgentManager(router, usageTracker);
}
