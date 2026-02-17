import { createLogger, generateId } from '@forgeai/shared';
import type { LLMResponse, UsageRecord, UsageSummary } from '@forgeai/shared';

const logger = createLogger('Agent:UsageTracker');

// Cost per 1M tokens (input/output) — approximate pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Moonshot (Kimi) — pricing in ¥ converted to $ (~0.14)
  'kimi-k2-0711': { input: 0.84, output: 2.8 },
  'moonshot-v1-auto': { input: 0.84, output: 2.8 },
  'moonshot-v1-8k': { input: 0.17, output: 0.17 },
  'moonshot-v1-32k': { input: 0.34, output: 0.34 },
  'moonshot-v1-128k': { input: 0.84, output: 0.84 },
  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Groq (hosted inference — very cheap)
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
};

export class UsageTracker {
  private records: UsageRecord[] = [];
  private maxInMemory: number;

  constructor(maxInMemory = 10_000) {
    this.maxInMemory = maxInMemory;
  }

  track(params: {
    sessionId: string;
    userId: string;
    response: LLMResponse;
    durationMs: number;
    channelType?: string;
  }): UsageRecord {
    const { sessionId, userId, response, durationMs, channelType } = params;

    const cost = this.calculateCost(
      response.model,
      response.usage.promptTokens,
      response.usage.completionTokens,
    );

    const record: UsageRecord = {
      id: generateId('usage'),
      sessionId,
      userId,
      provider: response.provider,
      model: response.model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      thinkingTokens: response.usage.thinkingTokens,
      cost,
      durationMs,
      channelType,
      createdAt: new Date(),
    };

    this.records.push(record);

    // Prune old records if too many in memory
    if (this.records.length > this.maxInMemory) {
      this.records = this.records.slice(-this.maxInMemory);
    }

    logger.debug('Usage tracked', {
      model: response.model,
      tokens: response.usage.totalTokens,
      cost: cost.toFixed(6),
    });

    return record;
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  getSummary(filter?: { userId?: string; sessionId?: string; since?: Date }): UsageSummary {
    let filtered = this.records;

    if (filter?.userId) {
      filtered = filtered.filter(r => r.userId === filter.userId);
    }
    if (filter?.sessionId) {
      filtered = filtered.filter(r => r.sessionId === filter.sessionId);
    }
    if (filter?.since) {
      filtered = filtered.filter(r => r.createdAt >= filter.since!);
    }

    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {};
    const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};

    let totalTokens = 0;
    let totalCost = 0;

    for (const r of filtered) {
      totalTokens += r.totalTokens;
      totalCost += r.cost;

      // By provider
      if (!byProvider[r.provider]) byProvider[r.provider] = { requests: 0, tokens: 0, cost: 0 };
      byProvider[r.provider].requests++;
      byProvider[r.provider].tokens += r.totalTokens;
      byProvider[r.provider].cost += r.cost;

      // By model
      if (!byModel[r.model]) byModel[r.model] = { requests: 0, tokens: 0, cost: 0 };
      byModel[r.model].requests++;
      byModel[r.model].tokens += r.totalTokens;
      byModel[r.model].cost += r.cost;
    }

    return {
      totalRequests: filtered.length,
      totalTokens,
      totalCost,
      byProvider,
      byModel,
    };
  }

  getRecords(limit = 100, offset = 0): UsageRecord[] {
    const sorted = [...this.records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sorted.slice(offset, offset + limit);
  }

  getSessionUsage(sessionId: string): { totalTokens: number; totalCost: number; requests: number } {
    const sessionRecords = this.records.filter(r => r.sessionId === sessionId);
    return {
      totalTokens: sessionRecords.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost: sessionRecords.reduce((sum, r) => sum + r.cost, 0),
      requests: sessionRecords.length,
    };
  }

  clear(): void {
    this.records = [];
  }

  get size(): number {
    return this.records.length;
  }
}

export function createUsageTracker(maxInMemory?: number): UsageTracker {
  return new UsageTracker(maxInMemory);
}
