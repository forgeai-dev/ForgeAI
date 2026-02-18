import { createLogger, generateId } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';
import type { LLMProviderAdapter } from './base.js';
import { LLMProviderError } from './base.js';

const logger = createLogger('Agent:Ollama');

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface OllamaChatResponse {
  id?: string;
  model: string;
  choices?: Array<{
    index: number;
    message: { role: string; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> };
    finish_reason: string;
  }>;
  // Native Ollama format (non-OpenAI mode)
  message?: { role: string; content: string };
  done?: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * OllamaProvider — supports Ollama, LM Studio, llama.cpp, and any OpenAI-compatible local server.
 *
 * Default URL: http://localhost:11434
 * Features:
 *  - Auto-discovers installed models via /api/tags
 *  - Uses /v1/chat/completions (OpenAI-compatible mode) for tool calling support
 *  - Falls back to /api/chat (native Ollama) if OpenAI mode fails
 *  - No API key required for local servers (uses "ollama" as placeholder)
 *  - Supports streaming via SSE
 */
export class OllamaProvider implements LLMProviderAdapter {
  readonly name: LLMProvider = 'local';
  readonly displayName = 'Local LLM (Ollama)';

  private baseUrl: string;
  private cachedModels: string[] = [];
  private lastModelFetch = 0;
  private static readonly MODEL_CACHE_MS = 30_000; // refresh model list every 30s

  private static readonly FALLBACK_MODELS = [
    'llama3.1:8b',
    'llama3.2:3b',
    'mistral:7b',
    'codellama:13b',
    'phi3:mini',
    'qwen2.5:7b',
    'gemma2:9b',
    'deepseek-r1:8b',
  ];

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434').replace(/\/+$/, '');
    logger.info(`Ollama provider initialized → ${this.baseUrl}`);
  }

  isConfigured(): boolean {
    // Local servers don't need an API key — always "configured" if URL is set
    return this.baseUrl.length > 0;
  }

  getApiKey(): string {
    return 'ollama'; // placeholder — local servers don't need keys
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  listModels(): string[] {
    // Return cached models if fresh, otherwise return fallback list
    // (actual discovery happens asynchronously via fetchModels)
    if (this.cachedModels.length > 0) return [...this.cachedModels];
    return [...OllamaProvider.FALLBACK_MODELS];
  }

  /**
   * Dynamically fetch installed models from Ollama /api/tags endpoint.
   * Results are cached for 30 seconds.
   */
  async fetchModels(): Promise<string[]> {
    const now = Date.now();
    if (this.cachedModels.length > 0 && (now - this.lastModelFetch) < OllamaProvider.MODEL_CACHE_MS) {
      return this.cachedModels;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      const data = await res.json() as { models?: OllamaModel[] };
      const models = (data.models ?? []).map(m => m.name).filter(Boolean);

      if (models.length > 0) {
        this.cachedModels = models;
        this.lastModelFetch = now;
        logger.info(`Discovered ${models.length} local models`, { models });
      }
      return models.length > 0 ? models : OllamaProvider.FALLBACK_MODELS;
    } catch (err) {
      logger.debug('Could not fetch Ollama models (server may be offline)', { error: (err as Error).message });
      return this.cachedModels.length > 0 ? this.cachedModels : OllamaProvider.FALLBACK_MODELS;
    }
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Refresh model cache in background
    this.fetchModels().catch(() => {});

    const messages = request.messages.map(m => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.imageData && m.role === 'user') {
        msg['images'] = [m.imageData.base64]; // Ollama native vision format
      }
      if (m.tool_call_id) msg['tool_call_id'] = m.tool_call_id;
      if (m.tool_calls) msg['tool_calls'] = m.tool_calls;
      return msg;
    });

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: false,
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    // If tools are provided, use OpenAI-compatible endpoint
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    logger.debug('Request', { model: request.model, endpoint: this.baseUrl, tools: request.tools?.length ?? 0 });

    // Try OpenAI-compatible endpoint first (better tool support)
    try {
      return await this.chatOpenAICompat(body, request);
    } catch (compatErr) {
      // If OpenAI endpoint fails, fall back to native Ollama /api/chat
      if (request.tools && request.tools.length > 0) {
        // Tools require OpenAI-compatible mode — can't fall back
        throw compatErr;
      }
      logger.debug('OpenAI-compatible endpoint failed, trying native Ollama', { error: (compatErr as Error).message });
      return this.chatNative(body, request);
    }
  }

  private async chatOpenAICompat(body: Record<string, unknown>, request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      throw new LLMProviderError(this.name, `Ollama API error ${response.status}: ${errorText}`, response.status, retryable);
    }

    const data = await response.json() as OllamaChatResponse;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new LLMProviderError(this.name, 'No choices in Ollama response');
    }

    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id || generateId(),
      name: tc.function.name,
      arguments: (() => {
        try { return JSON.parse(tc.function.arguments); } catch { return {}; }
      })(),
    }));

    return {
      id: data.id || generateId(),
      model: data.model || request.model,
      provider: this.name,
      content: choice.message.content || '',
      toolCalls,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  private async chatNative(body: Record<string, unknown>, request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status >= 500;
      throw new LLMProviderError(this.name, `Ollama native error ${response.status}: ${errorText}`, response.status, retryable);
    }

    const data = await response.json() as OllamaChatResponse;
    const content = data.message?.content ?? '';

    return {
      id: generateId(),
      model: data.model || request.model,
      provider: this.name,
      content,
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finishReason: 'stop',
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    this.fetchModels().catch(() => {});

    const messages = request.messages.map(m => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.imageData && m.role === 'user') {
        msg['images'] = [m.imageData.base64];
      }
      return msg;
    });

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMProviderError(this.name, `Ollama stream error ${response.status}: ${errorText}`, response.status, true);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let model = request.model;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const chunk = JSON.parse(payload) as {
              id?: string;
              model?: string;
              choices: Array<{ delta: { content?: string }; finish_reason: string | null }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            model = chunk.model || model;
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              yield delta.content;
            }
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens;
              completionTokens = chunk.usage.completion_tokens;
            }
          } catch {
            // skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: generateId(),
      model,
      provider: this.name,
      content: fullContent,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: 'stop',
    };
  }

  private mapFinishReason(reason: string): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_calls';
      default: return 'stop';
    }
  }
}
