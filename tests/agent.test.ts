import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LLMRouter, type FailoverEvent } from '../packages/agent/src/router.js';
import { LLMProviderError } from '../packages/agent/src/providers/base.js';
import type { LLMProviderAdapter } from '../packages/agent/src/providers/base.js';
import type { LLMRequest, LLMResponse, LLMProvider } from '../packages/shared/src/types/index.js';
import { MemoryManager } from '../packages/agent/src/memory-manager.js';
import { UsageTracker } from '../packages/agent/src/usage-tracker.js';

// ─── Mock Provider Factory ────────────────────────────────────
function createMockProvider(
  name: LLMProvider,
  opts: { shouldFail?: boolean; retryable?: boolean; failCount?: number } = {},
): LLMProviderAdapter {
  let failures = 0;
  const failLimit = opts.failCount ?? Infinity;

  return {
    name,
    displayName: `Mock ${name}`,
    isConfigured: () => true,
    listModels: () => [`${name}-model`],
    chat: async (req: LLMRequest): Promise<LLMResponse> => {
      if (opts.shouldFail && failures < failLimit) {
        failures++;
        throw new LLMProviderError(name, 'Mock failure', 500, opts.retryable ?? false);
      }
      return {
        id: `mock-${Date.now()}`,
        content: `Response from ${name}`,
        model: req.model ?? `${name}-model`,
        provider: name,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },
    chatStream: async function* (req: LLMRequest): AsyncGenerator<string, LLMResponse> {
      if (opts.shouldFail) {
        throw new LLMProviderError(name, 'Mock stream failure', 500, false);
      }
      yield `Chunk from ${name}`;
      return {
        id: `mock-stream-${Date.now()}`,
        content: `Stream from ${name}`,
        model: req.model ?? `${name}-model`,
        provider: name,
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. LLM ROUTER (Circuit Breaker + Failover)
// ═══════════════════════════════════════════════════════════════
describe('LLMRouter', () => {
  let router: LLMRouter;

  const baseRequest: LLMRequest = {
    messages: [{ role: 'user', content: 'Hello' }],
    provider: 'anthropic' as LLMProvider,
    model: 'claude-sonnet-4-20250514',
  };

  beforeEach(() => {
    router = new LLMRouter([
      { priority: 1, provider: 'anthropic' as LLMProvider, model: 'claude-sonnet-4-20250514' },
      { priority: 2, provider: 'openai' as LLMProvider, model: 'gpt-4o', fallback: true },
      { priority: 3, provider: 'google' as LLMProvider, model: 'gemini-2.5-flash', fallback: true },
    ], 0); // 0 retries for fast tests
  });

  describe('Basic Routing', () => {
    it('should route to primary provider', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      router.registerProvider(createMockProvider('openai' as LLMProvider));

      const response = await router.chat(baseRequest);
      expect(response.provider).toBe('anthropic');
      expect(response.content).toBe('Response from anthropic');
    });

    it('should return null failover on primary success', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      await router.chat(baseRequest);
      expect(router.consumeLastFailover()).toBeNull();
    });
  });

  describe('Failover', () => {
    it('should failover to next provider on failure', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider, { shouldFail: true }));
      router.registerProvider(createMockProvider('openai' as LLMProvider));

      const response = await router.chat(baseRequest);
      expect(response.provider).toBe('openai');

      const failover = router.consumeLastFailover();
      expect(failover).not.toBeNull();
      expect(failover!.from.provider).toBe('anthropic');
      expect(failover!.to.provider).toBe('openai');
    });

    it('should failover through multiple providers', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider, { shouldFail: true }));
      router.registerProvider(createMockProvider('openai' as LLMProvider, { shouldFail: true }));
      router.registerProvider(createMockProvider('google' as LLMProvider));

      const response = await router.chat(baseRequest);
      expect(response.provider).toBe('google');
    });

    it('should throw when all providers fail', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider, { shouldFail: true }));
      router.registerProvider(createMockProvider('openai' as LLMProvider, { shouldFail: true }));
      router.registerProvider(createMockProvider('google' as LLMProvider, { shouldFail: true }));

      await expect(router.chat(baseRequest)).rejects.toThrow('Mock failure');
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after 5 failures', async () => {
      const failingProvider = createMockProvider('anthropic' as LLMProvider, { shouldFail: true });
      const fallbackProvider = createMockProvider('openai' as LLMProvider);
      router.registerProvider(failingProvider);
      router.registerProvider(fallbackProvider);

      // 5 failures to trip the circuit
      for (let i = 0; i < 5; i++) {
        await router.chat(baseRequest);
      }

      const status = router.getCircuitStatus();
      expect(status['anthropic']).toBeDefined();
      expect(status['anthropic'].failures).toBe(5);
      expect(status['anthropic'].open).toBe(true);
    });

    it('should skip provider with open circuit', async () => {
      const failingProvider = createMockProvider('anthropic' as LLMProvider, { shouldFail: true });
      const fallbackProvider = createMockProvider('openai' as LLMProvider);
      router.registerProvider(failingProvider);
      router.registerProvider(fallbackProvider);

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        await router.chat(baseRequest);
      }

      // Next call should go directly to openai (circuit open for anthropic)
      const response = await router.chat(baseRequest);
      expect(response.provider).toBe('openai');
    });

    it('should reset circuit on provider re-registration', async () => {
      const failingProvider = createMockProvider('anthropic' as LLMProvider, { shouldFail: true });
      const fallbackProvider = createMockProvider('openai' as LLMProvider);
      router.registerProvider(failingProvider);
      router.registerProvider(fallbackProvider);

      for (let i = 0; i < 5; i++) {
        await router.chat(baseRequest);
      }

      // Re-register resets circuit
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      const status = router.getCircuitStatus();
      expect(status['anthropic']).toBeUndefined();
    });
  });

  describe('Provider Management', () => {
    it('should register and list providers', () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      router.registerProvider(createMockProvider('openai' as LLMProvider));

      const providers = router.getProviders();
      expect(providers.size).toBe(2);
    });

    it('should remove providers', () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      expect(router.removeProvider('anthropic' as LLMProvider)).toBe(true);
      expect(router.getProviders().size).toBe(0);
    });

    it('should return false for removing non-existent provider', () => {
      expect(router.removeProvider('anthropic' as LLMProvider)).toBe(false);
    });

    it('should get and set routes', () => {
      const routes = router.getRoutes();
      expect(routes).toHaveLength(3);

      router.setRoutes([{ priority: 1, provider: 'openai' as LLMProvider, model: 'gpt-4o' }]);
      expect(router.getRoutes()).toHaveLength(1);
    });
  });

  describe('Custom Route Request', () => {
    it('should prioritize request-specific provider+model', async () => {
      router.registerProvider(createMockProvider('anthropic' as LLMProvider));
      router.registerProvider(createMockProvider('openai' as LLMProvider));

      const response = await router.chat({
        messages: [{ role: 'user', content: 'test' }],
        provider: 'openai' as LLMProvider,
        model: 'gpt-4o',
      });
      expect(response.provider).toBe('openai');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. MEMORY MANAGER (TF-IDF Embeddings + Cosine Similarity)
// ═══════════════════════════════════════════════════════════════
describe('MemoryManager', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager({ maxEntries: 100, similarityThreshold: 0.1 });
  });

  describe('Store & Retrieve', () => {
    it('should store and get a memory entry', () => {
      const entry = memory.store('m1', 'TypeScript is great for type safety');
      expect(entry.id).toBe('m1');
      expect(entry.content).toBe('TypeScript is great for type safety');
      expect(entry.embedding.length).toBeGreaterThan(0);
      expect(entry.importance).toBeGreaterThan(0);

      expect(memory.get('m1')).toEqual(entry);
    });

    it('should return undefined for non-existent entry', () => {
      expect(memory.get('nope')).toBeUndefined();
    });

    it('should delete entries', () => {
      memory.store('m1', 'test content');
      expect(memory.delete('m1')).toBe(true);
      expect(memory.get('m1')).toBeUndefined();
    });
  });

  describe('Search (Cosine Similarity)', () => {
    it('should find similar entries', () => {
      memory.store('m1', 'TypeScript is a typed programming language');
      memory.store('m2', 'Python is great for data science');
      memory.store('m3', 'TypeScript provides type safety and autocompletion');

      const results = memory.search('TypeScript type safety');
      expect(results.length).toBeGreaterThan(0);
      // m1 and m3 should rank higher than m2
      const ids = results.map(r => r.entry.id);
      const tsIndex = ids.indexOf('m1');
      const pyIndex = ids.indexOf('m2');
      if (tsIndex !== -1 && pyIndex !== -1) {
        expect(tsIndex).toBeLessThan(pyIndex);
      }
    });

    it('should filter by session ID', () => {
      memory.store('m1', 'session one content', {}, 'session-1');
      memory.store('m2', 'session two content', {}, 'session-2');

      const results = memory.search('content', 10, 'session-1');
      const ids = results.map(r => r.entry.id);
      expect(ids).not.toContain('m2');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        memory.store(`m${i}`, `memory entry number ${i} about testing`);
      }
      const results = memory.search('testing', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getBySession', () => {
    it('should return entries for a session sorted by timestamp', () => {
      memory.store('m1', 'first', {}, 'sess-1');
      memory.store('m2', 'second', {}, 'sess-1');
      memory.store('m3', 'other session', {}, 'sess-2');

      const entries = memory.getBySession('sess-1');
      expect(entries).toHaveLength(2);
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(entries[1].timestamp);
    });
  });

  describe('Importance Calculation', () => {
    it('should give higher importance to longer content', () => {
      const short = memory.store('s', 'hi');
      const long = memory.store('l', 'a'.repeat(300) + ' detailed explanation');
      expect(long.importance).toBeGreaterThan(short.importance);
    });

    it('should give higher importance to user-flagged entries', () => {
      const normal = memory.store('n', 'normal entry');
      const important = memory.store('i', 'important entry', { important: true });
      expect(important.importance).toBeGreaterThan(normal.importance);
    });

    it('should give slight boost to questions', () => {
      const statement = memory.store('s', 'the sky is blue');
      const question = memory.store('q', 'is the sky blue?');
      expect(question.importance).toBeGreaterThanOrEqual(statement.importance);
    });
  });

  describe('Eviction', () => {
    it('should evict lowest importance when over maxEntries', () => {
      const smallMemory = new MemoryManager({ maxEntries: 3 });
      smallMemory.store('m1', 'first entry');
      smallMemory.store('m2', 'second entry');
      smallMemory.store('m3', 'third entry');
      smallMemory.store('m4', 'fourth entry that triggers eviction');

      const stats = smallMemory.getStats();
      expect(stats.total).toBeLessThanOrEqual(3);
    });
  });

  describe('Consolidation', () => {
    it('should merge near-duplicate entries', () => {
      memory.store('m1', 'TypeScript is a great language for development');
      memory.store('m2', 'TypeScript is a great language for development'); // duplicate

      const result = memory.consolidate();
      expect(result.removed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Stats & Clear', () => {
    it('should return correct stats', () => {
      memory.store('m1', 'entry one', {}, 'sess-1');
      memory.store('m2', 'entry two', {}, 'sess-2');

      const stats = memory.getStats();
      expect(stats.total).toBe(2);
      expect(stats.sessions).toBe(2);
      expect(stats.avgImportance).toBeGreaterThan(0);
    });

    it('should clear all entries', () => {
      memory.store('m1', 'test');
      memory.clear();
      expect(memory.getStats().total).toBe(0);
    });

    it('should return config', () => {
      const config = memory.getConfig();
      expect(config.maxEntries).toBe(100);
      expect(config.similarityThreshold).toBe(0.1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. USAGE TRACKER (Cost Calculation + Filtering)
// ═══════════════════════════════════════════════════════════════
describe('UsageTracker', () => {
  let tracker: UsageTracker;

  const mockResponse = (model: string, prompt: number, completion: number): LLMResponse => ({
    id: `mock-${Date.now()}`,
    content: 'test response',
    model,
    provider: 'openai' as LLMProvider,
    finishReason: 'stop' as const,
    usage: { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion },
  });

  beforeEach(() => {
    tracker = new UsageTracker(100);
  });

  describe('Cost Calculation', () => {
    it('should calculate GPT-4o cost correctly', () => {
      // GPT-4o: $2.5/1M input, $10/1M output
      const cost = tracker.calculateCost('gpt-4o', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(12.5, 1); // $2.5 + $10
    });

    it('should calculate GPT-4o-mini cost correctly', () => {
      // GPT-4o-mini: $0.15/1M input, $0.6/1M output
      const cost = tracker.calculateCost('gpt-4o-mini', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.75, 2);
    });

    it('should calculate Claude Sonnet cost correctly', () => {
      // Claude Sonnet: $3/1M input, $15/1M output
      const cost = tracker.calculateCost('claude-sonnet-4-20250514', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(18.0, 1);
    });

    it('should return 0 for unknown model', () => {
      expect(tracker.calculateCost('unknown-model', 1000, 1000)).toBe(0);
    });

    it('should handle small token counts', () => {
      // 1000 tokens of GPT-4o input = $0.0025
      const cost = tracker.calculateCost('gpt-4o', 1000, 0);
      expect(cost).toBeCloseTo(0.0025, 4);
    });
  });

  describe('Tracking', () => {
    it('should track a usage record', () => {
      const record = tracker.track({
        sessionId: 'sess-1',
        userId: 'user-1',
        response: mockResponse('gpt-4o', 500, 200),
        durationMs: 1200,
        channelType: 'web',
      });

      expect(record.id).toContain('usage_');
      expect(record.sessionId).toBe('sess-1');
      expect(record.totalTokens).toBe(700);
      expect(record.cost).toBeGreaterThan(0);
      expect(record.channelType).toBe('web');
      expect(tracker.size).toBe(1);
    });

    it('should prune old records when exceeding max', () => {
      const smallTracker = new UsageTracker(5);
      for (let i = 0; i < 10; i++) {
        smallTracker.track({
          sessionId: `sess-${i}`,
          userId: 'user-1',
          response: mockResponse('gpt-4o', 100, 50),
          durationMs: 100,
        });
      }
      expect(smallTracker.size).toBeLessThanOrEqual(5);
    });
  });

  describe('Summary & Filtering', () => {
    beforeEach(() => {
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o', 1000, 500), durationMs: 100 });
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o-mini', 2000, 1000), durationMs: 200 });
      tracker.track({ sessionId: 's2', userId: 'u2', response: mockResponse('gpt-4o', 500, 200), durationMs: 50 });
    });

    it('should return full summary', () => {
      const summary = tracker.getSummary();
      expect(summary.totalRequests).toBe(3);
      expect(summary.totalTokens).toBe(1000 + 500 + 2000 + 1000 + 500 + 200);
      expect(summary.totalCost).toBeGreaterThan(0);
      expect(summary.byProvider['openai']).toBeDefined();
      expect(summary.byModel['gpt-4o']).toBeDefined();
      expect(summary.byModel['gpt-4o-mini']).toBeDefined();
    });

    it('should filter by userId', () => {
      const summary = tracker.getSummary({ userId: 'u1' });
      expect(summary.totalRequests).toBe(2);
    });

    it('should filter by sessionId', () => {
      const summary = tracker.getSummary({ sessionId: 's2' });
      expect(summary.totalRequests).toBe(1);
    });

    it('should filter by date', () => {
      const future = new Date(Date.now() + 100_000);
      const summary = tracker.getSummary({ since: future });
      expect(summary.totalRequests).toBe(0);
    });
  });

  describe('Session Usage', () => {
    it('should aggregate session usage', () => {
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o', 100, 50), durationMs: 100 });
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o', 200, 100), durationMs: 100 });

      const usage = tracker.getSessionUsage('s1');
      expect(usage.requests).toBe(2);
      expect(usage.totalTokens).toBe(450);
      expect(usage.totalCost).toBeGreaterThan(0);
    });

    it('should return 0 for unknown session', () => {
      const usage = tracker.getSessionUsage('unknown');
      expect(usage.requests).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });
  });

  describe('Records & Clear', () => {
    it('should return records sorted by date (newest first)', () => {
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o', 100, 50), durationMs: 100 });
      tracker.track({ sessionId: 's2', userId: 'u1', response: mockResponse('gpt-4o', 100, 50), durationMs: 100 });

      const records = tracker.getRecords(10);
      expect(records).toHaveLength(2);
      expect(records[0].createdAt.getTime()).toBeGreaterThanOrEqual(records[1].createdAt.getTime());
    });

    it('should clear all records', () => {
      tracker.track({ sessionId: 's1', userId: 'u1', response: mockResponse('gpt-4o', 100, 50), durationMs: 100 });
      tracker.clear();
      expect(tracker.size).toBe(0);
    });
  });
});
