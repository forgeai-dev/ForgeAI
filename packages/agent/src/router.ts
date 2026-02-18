import { createLogger } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider, ModelRoute } from '@forgeai/shared';
import type { LLMProviderAdapter } from './providers/base.js';
import { LLMProviderError } from './providers/base.js';

const logger = createLogger('Agent:Router');

const DEFAULT_ROUTES: ModelRoute[] = [
  { priority: 1, provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  { priority: 2, provider: 'openai', model: 'gpt-4o', fallback: true },
  { priority: 3, provider: 'google', model: 'gemini-2.5-flash', fallback: true },
  { priority: 4, provider: 'moonshot', model: 'kimi-k2.5', fallback: true },
  { priority: 5, provider: 'deepseek', model: 'deepseek-chat', fallback: true },
  { priority: 6, provider: 'groq', model: 'llama-3.3-70b-versatile', fallback: true },
  { priority: 7, provider: 'mistral', model: 'mistral-large-latest', fallback: true },
  { priority: 8, provider: 'xai', model: 'grok-3', fallback: true },
  { priority: 9, provider: 'anthropic', model: 'claude-3-5-haiku-20241022', fallback: true },
  { priority: 10, provider: 'openai', model: 'gpt-4o-mini', fallback: true },
  { priority: 11, provider: 'local', model: 'llama3.1:8b', fallback: true },
];

// ─── Circuit Breaker ────────────────────────────
interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number; // timestamp — skip provider until this time
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_WINDOW_MS = 5 * 60_000;   // 5 minutes
const CIRCUIT_COOLDOWN_MS = 2 * 60_000; // 2 minutes cooldown after tripping

// ─── Failover Event ────────────────────────────
export interface FailoverEvent {
  from: { provider: string; model: string };
  to: { provider: string; model: string };
  reason: string;
  timestamp: number;
}

export class LLMRouter {
  private providers: Map<LLMProvider, LLMProviderAdapter> = new Map();
  private routes: ModelRoute[];
  private maxRetries: number;
  private circuits: Map<string, CircuitState> = new Map();
  private _lastFailover: FailoverEvent | null = null;

  constructor(routes?: ModelRoute[], maxRetries = 2) {
    this.routes = routes ?? DEFAULT_ROUTES;
    this.maxRetries = maxRetries;
    logger.info('LLM Router initialized (providers loaded from Vault)');
  }

  registerProvider(provider: LLMProviderAdapter): void {
    this.providers.set(provider.name, provider);
    // Reset circuit breaker when provider is (re)registered
    this.circuits.delete(provider.name);
    logger.info(`Provider registered: ${provider.displayName}`);
  }

  /** Last failover event (null if primary succeeded). Consumed once by caller. */
  consumeLastFailover(): FailoverEvent | null {
    const ev = this._lastFailover;
    this._lastFailover = null;
    return ev;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this._lastFailover = null;
    const chain = this.buildFallbackChain(request);

    let lastError: Error | null = null;
    let attempted = 0;

    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (!provider) continue;
      if (this.isCircuitOpen(route.provider)) {
        logger.debug(`Circuit open, skipping ${route.provider}`);
        continue;
      }

      attempted++;
      try {
        const routedRequest = { ...request, provider: route.provider, model: route.model };
        const response = await this.executeWithRetry(provider, routedRequest);

        // Track failover if we're not on the first route
        if (attempted > 1) {
          const primary = chain[0];
          this._lastFailover = {
            from: { provider: primary.provider, model: primary.model },
            to: { provider: route.provider, model: route.model },
            reason: lastError?.message ?? 'unknown',
            timestamp: Date.now(),
          };
          logger.info(`⚡ Failover: ${primary.provider}/${primary.model} → ${route.provider}/${route.model}`);
        }

        // Reset circuit on success
        this.circuits.delete(route.provider);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordCircuitFailure(route.provider);

        logger.warn(`Route failed: ${route.provider}/${route.model}`, {
          error: lastError.message,
          fallback: route.fallback,
          circuitFailures: this.circuits.get(route.provider)?.failures ?? 0,
        });

        // Non-fallback + non-retryable → still continue to fallback chain
        continue;
      }
    }

    throw lastError ?? new Error('No LLM providers available');
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    this._lastFailover = null;
    const chain = this.buildFallbackChain(request);

    let lastError: Error | null = null;
    let attempted = 0;

    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (!provider) continue;
      if (this.isCircuitOpen(route.provider)) continue;

      attempted++;
      try {
        const routedRequest = { ...request, provider: route.provider, model: route.model };
        const result = yield* provider.chatStream(routedRequest);

        if (attempted > 1) {
          const primary = chain[0];
          this._lastFailover = {
            from: { provider: primary.provider, model: primary.model },
            to: { provider: route.provider, model: route.model },
            reason: lastError?.message ?? 'unknown',
            timestamp: Date.now(),
          };
          logger.info(`⚡ Stream failover: ${primary.provider}/${primary.model} → ${route.provider}/${route.model}`);
        }

        this.circuits.delete(route.provider);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordCircuitFailure(route.provider);
        logger.warn(`Stream route failed: ${route.provider}/${route.model}`, { error: lastError.message });
        continue;
      }
    }

    throw lastError ?? new Error('No LLM providers available for streaming');
  }

  /**
   * Build the ordered fallback chain.
   * If request has specific provider+model, put that first, then append remaining routes.
   */
  private buildFallbackChain(request: LLMRequest): ModelRoute[] {
    const sortedRoutes = [...this.routes].sort((a, b) => a.priority - b.priority);

    if (request.provider && request.model) {
      // Requested specific provider — put it first, then add fallback routes
      const specificRoute: ModelRoute = {
        priority: 0,
        provider: request.provider,
        model: request.model,
        fallback: false,
      };
      // Remove duplicate if it already exists in routes
      const rest = sortedRoutes.filter(
        r => !(r.provider === request.provider && r.model === request.model)
      );
      return [specificRoute, ...rest];
    }

    return sortedRoutes;
  }

  private async executeWithRetry(provider: LLMProviderAdapter, request: LLMRequest): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await provider.chat(request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof LLMProviderError && !error.retryable) throw error;

        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.debug(`Retry ${attempt + 1}/${this.maxRetries} in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  // ─── Circuit Breaker ────────────────────────────

  private isCircuitOpen(provider: string): boolean {
    const state = this.circuits.get(provider);
    if (!state) return false;
    if (Date.now() > state.openUntil) {
      // Cooldown expired — allow one attempt (half-open)
      return false;
    }
    return state.failures >= CIRCUIT_FAILURE_THRESHOLD;
  }

  private recordCircuitFailure(provider: string): void {
    const now = Date.now();
    const state = this.circuits.get(provider) ?? { failures: 0, lastFailure: 0, openUntil: 0 };

    // Reset counter if outside the failure window
    if (now - state.lastFailure > CIRCUIT_WINDOW_MS) {
      state.failures = 0;
    }

    state.failures++;
    state.lastFailure = now;

    if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      state.openUntil = now + CIRCUIT_COOLDOWN_MS;
      logger.warn(`🔴 Circuit breaker OPEN for ${provider} — ${state.failures} failures in window, cooldown ${CIRCUIT_COOLDOWN_MS / 1000}s`);
    }

    this.circuits.set(provider, state);
  }

  getCircuitStatus(): Record<string, { failures: number; open: boolean; cooldownRemaining?: number }> {
    const result: Record<string, { failures: number; open: boolean; cooldownRemaining?: number }> = {};
    for (const [name, state] of this.circuits) {
      const isOpen = this.isCircuitOpen(name);
      result[name] = {
        failures: state.failures,
        open: isOpen,
        cooldownRemaining: isOpen ? Math.max(0, state.openUntil - Date.now()) : undefined,
      };
    }
    return result;
  }

  removeProvider(name: LLMProvider): boolean {
    const result = this.providers.delete(name);
    if (result) {
      this.circuits.delete(name);
      logger.info(`Provider removed: ${name}`);
    }
    return result;
  }

  async getBalances(): Promise<Array<{ provider: string; displayName: string; available: boolean; balance?: number; currency?: string }>> {
    const results: Array<{ provider: string; displayName: string; available: boolean; balance?: number; currency?: string }> = [];
    const promises = [...this.providers.values()]
      .filter(p => p.isConfigured() && typeof p.getBalance === 'function')
      .map(async (p) => {
        try {
          return await p.getBalance!();
        } catch {
          return { provider: p.name, displayName: p.displayName, available: false };
        }
      });
    const settled = await Promise.allSettled(promises);
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
    // Also add providers that don't support balance
    for (const p of this.providers.values()) {
      if (p.isConfigured() && typeof p.getBalance !== 'function') {
        results.push({ provider: p.name, displayName: p.displayName, available: false });
      }
    }
    return results;
  }

  getProviders(): Map<LLMProvider, LLMProviderAdapter> {
    return new Map(this.providers);
  }

  getRoutes(): ModelRoute[] {
    return [...this.routes];
  }

  setRoutes(routes: ModelRoute[]): void {
    this.routes = routes;
    logger.info('Routes updated', { count: routes.length });
  }
}

export function createLLMRouter(routes?: ModelRoute[], maxRetries?: number): LLMRouter {
  return new LLMRouter(routes, maxRetries);
}
