import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:Telemetry');

export interface OTelConfig {
  /** Enable telemetry (default: false) */
  enabled: boolean;
  /** OTLP endpoint for traces (e.g. http://localhost:4318/v1/traces) */
  tracesEndpoint?: string;
  /** OTLP endpoint for metrics (e.g. http://localhost:4318/v1/metrics) */
  metricsEndpoint?: string;
  /** Service name (default: 'forgeai-gateway') */
  serviceName?: string;
  /** Export interval in ms (default: 30000) */
  exportIntervalMs?: number;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string | number> }>;
}

export interface MetricPoint {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  labels: Record<string, string>;
  timestamp: number;
}

/**
 * Lightweight OpenTelemetry-compatible manager.
 * Collects traces and metrics in-memory and exports to OTLP/HTTP endpoint.
 * No heavy SDK dependency — uses native fetch + simple data structures.
 */
export class OTelManager {
  private config: OTelConfig;
  private spans: SpanData[] = [];
  private metrics: MetricPoint[] = [];
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private exportTimer: ReturnType<typeof setInterval> | null = null;
  private _startTime = Date.now();

  constructor(config?: Partial<OTelConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      tracesEndpoint: config?.tracesEndpoint,
      metricsEndpoint: config?.metricsEndpoint,
      serviceName: config?.serviceName ?? 'forgeai-gateway',
      exportIntervalMs: config?.exportIntervalMs ?? 30000,
    };

    if (this.config.enabled) {
      this.start();
    }
  }

  // ─── Lifecycle ─────────────────────────────

  start(): void {
    if (this.exportTimer) return;
    this.config.enabled = true;
    this._startTime = Date.now();

    if (this.config.tracesEndpoint || this.config.metricsEndpoint) {
      this.exportTimer = setInterval(() => this.flush(), this.config.exportIntervalMs!);
      logger.info('OpenTelemetry started', {
        traces: this.config.tracesEndpoint ?? 'disabled',
        metrics: this.config.metricsEndpoint ?? 'disabled',
        interval: `${this.config.exportIntervalMs}ms`,
      });
    } else {
      logger.info('OpenTelemetry started (in-memory only, no export endpoint configured)');
    }
  }

  stop(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }
    this.flush();
    this.config.enabled = false;
    logger.info('OpenTelemetry stopped');
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  // ─── Traces ────────────────────────────────

  startSpan(name: string, attributes?: Record<string, string | number | boolean>): SpanData {
    const span: SpanData = {
      traceId: this.generateId(16),
      spanId: this.generateId(8),
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: { 'service.name': this.config.serviceName!, ...attributes },
      events: [],
    };
    return span;
  }

  endSpan(span: SpanData, status: 'ok' | 'error' = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;
    span.attributes['duration_ms'] = span.endTime - span.startTime;
    if (this.config.enabled) {
      this.spans.push(span);
      // Keep max 1000 spans in memory
      if (this.spans.length > 1000) this.spans.splice(0, this.spans.length - 1000);
    }
  }

  addSpanEvent(span: SpanData, name: string, attributes?: Record<string, string | number>): void {
    span.events.push({ name, timestamp: Date.now(), attributes });
  }

  // ─── Metrics ───────────────────────────────

  incrementCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = `${name}|${JSON.stringify(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    if (this.config.enabled) {
      this.metrics.push({ name, value, type: 'counter', labels, timestamp: Date.now() });
      if (this.metrics.length > 5000) this.metrics.splice(0, this.metrics.length - 5000);
    }
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}|${JSON.stringify(labels)}`;
    this.gauges.set(key, value);
    if (this.config.enabled) {
      this.metrics.push({ name, value, type: 'gauge', labels, timestamp: Date.now() });
      if (this.metrics.length > 5000) this.metrics.splice(0, this.metrics.length - 5000);
    }
  }

  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (this.config.enabled) {
      this.metrics.push({ name, value, type: 'histogram', labels, timestamp: Date.now() });
      if (this.metrics.length > 5000) this.metrics.splice(0, this.metrics.length - 5000);
    }
  }

  // ─── Pre-built instrumentation ─────────────

  /** Track an HTTP request */
  trackRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    this.incrementCounter('http.requests.total', 1, { method, path: this.normalizePath(path), status: String(statusCode) });
    this.recordHistogram('http.request.duration_ms', durationMs, { method, path: this.normalizePath(path) });
  }

  /** Track a chat message */
  trackChatMessage(channel: string, agentId: string, durationMs: number, tokens?: number): void {
    this.incrementCounter('chat.messages.total', 1, { channel, agent: agentId });
    this.recordHistogram('chat.response.duration_ms', durationMs, { channel, agent: agentId });
    if (tokens) this.incrementCounter('chat.tokens.total', tokens, { agent: agentId });
  }

  /** Track a tool execution */
  trackToolExecution(toolName: string, success: boolean, durationMs: number): void {
    this.incrementCounter('tool.executions.total', 1, { tool: toolName, success: String(success) });
    this.recordHistogram('tool.execution.duration_ms', durationMs, { tool: toolName });
  }

  /** Track LLM provider call */
  trackLLMCall(provider: string, model: string, durationMs: number, tokens: number, success: boolean): void {
    this.incrementCounter('llm.calls.total', 1, { provider, model, success: String(success) });
    this.recordHistogram('llm.call.duration_ms', durationMs, { provider, model });
    this.incrementCounter('llm.tokens.total', tokens, { provider, model });
  }

  // ─── Status / Export ───────────────────────

  getStatus(): {
    enabled: boolean;
    tracesEndpoint: string | null;
    metricsEndpoint: string | null;
    spansCollected: number;
    metricsCollected: number;
    counters: Record<string, number>;
    uptimeMs: number;
  } {
    const counters: Record<string, number> = {};
    for (const [key, val] of this.counters) {
      const name = key.split('|')[0];
      counters[name] = (counters[name] ?? 0) + val;
    }
    return {
      enabled: this.config.enabled,
      tracesEndpoint: this.config.tracesEndpoint ?? null,
      metricsEndpoint: this.config.metricsEndpoint ?? null,
      spansCollected: this.spans.length,
      metricsCollected: this.metrics.length,
      counters,
      uptimeMs: Date.now() - this._startTime,
    };
  }

  getRecentSpans(limit: number = 50): SpanData[] {
    return this.spans.slice(-limit);
  }

  getRecentMetrics(limit: number = 100): MetricPoint[] {
    return this.metrics.slice(-limit);
  }

  async flush(): Promise<void> {
    if (this.config.tracesEndpoint && this.spans.length > 0) {
      const batch = this.spans.splice(0, 500);
      try {
        await fetch(this.config.tracesEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceSpans: [{
              resource: { attributes: [{ key: 'service.name', value: { stringValue: this.config.serviceName } }] },
              scopeSpans: [{ spans: batch.map(s => this.spanToOTLP(s)) }],
            }],
          }),
        });
      } catch (err) {
        // Put back on failure
        this.spans.unshift(...batch);
        logger.debug('Failed to export traces', { error: String(err) });
      }
    }

    if (this.config.metricsEndpoint && this.metrics.length > 0) {
      const batch = this.metrics.splice(0, 1000);
      try {
        await fetch(this.config.metricsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: batch }] }] }),
        });
      } catch (err) {
        this.metrics.unshift(...batch);
        logger.debug('Failed to export metrics', { error: String(err) });
      }
    }
  }

  // ─── Helpers ───────────────────────────────

  private generateId(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  private normalizePath(path: string): string {
    return path.replace(/\/[a-f0-9-]{8,}/g, '/:id').replace(/\/\d+/g, '/:n');
  }

  private spanToOTLP(span: SpanData): Record<string, unknown> {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      startTimeUnixNano: String(span.startTime * 1_000_000),
      endTimeUnixNano: span.endTime ? String(span.endTime * 1_000_000) : undefined,
      status: { code: span.status === 'ok' ? 1 : span.status === 'error' ? 2 : 0 },
      attributes: Object.entries(span.attributes).map(([k, v]) => ({
        key: k,
        value: typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { intValue: String(v) } : { boolValue: v },
      })),
      events: span.events.map(e => ({
        name: e.name,
        timeUnixNano: String(e.timestamp * 1_000_000),
      })),
    };
  }
}

let instance: OTelManager | null = null;

export function createOTelManager(config?: Partial<OTelConfig>): OTelManager {
  instance = new OTelManager(config);
  return instance;
}

export function getOTelManager(): OTelManager | null {
  return instance;
}
