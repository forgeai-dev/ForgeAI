import { createLogger, generateId } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';
import type { LLMProviderAdapter } from './base.js';
import { LLMProviderError } from './base.js';

interface OpenAICompatibleConfig {
  name: LLMProvider;
  displayName: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: string[];
  defaultHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  maxTemperature?: number;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAICompatibleResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string; reasoning_content?: string; tool_calls?: OpenAIToolCall[] };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAICompatibleStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function safeJsonParse(str: string, fallbackLabel: string, logger: { warn: (message: string, data?: Record<string, unknown>) => void }): Record<string, unknown> {
  try {
    return JSON.parse(str || '{}');
  } catch {
    logger.warn(`Failed to parse ${fallbackLabel} JSON (${str.length} chars), attempting repair`);
    // Try to repair truncated JSON by closing open strings/braces
    let repaired = str;
    // Count open braces/brackets
    let braces = 0, brackets = 0, inString = false, lastChar = '';
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (c === '"' && lastChar !== '\\') inString = !inString;
      if (!inString) {
        if (c === '{') braces++;
        if (c === '}') braces--;
        if (c === '[') brackets++;
        if (c === ']') brackets--;
      }
      lastChar = c;
    }
    if (inString) repaired += '"';
    while (brackets > 0) { repaired += ']'; brackets--; }
    while (braces > 0) { repaired += '}'; braces--; }
    try {
      const parsed = JSON.parse(repaired);
      parsed._repaired = true;
      return parsed;
    } catch {
      logger.warn(`JSON repair also failed for ${fallbackLabel}, using raw string as content`);
      return { _raw: str.substring(0, 2000), _truncated: true };
    }
  }
}

export class OpenAICompatibleProvider implements LLMProviderAdapter {
  readonly name: LLMProvider;
  readonly displayName: string;

  private apiKey: string;
  private baseUrl: string;
  private models: string[];
  private extraHeaders: Record<string, string>;
  private extraBody: Record<string, unknown>;
  private maxTemperature: number;
  private logger;

  constructor(config: OpenAICompatibleConfig, apiKey?: string) {
    this.name = config.name;
    this.displayName = config.displayName;
    this.baseUrl = config.baseUrl;
    this.models = config.models;
    this.extraHeaders = config.defaultHeaders ?? {};
    this.extraBody = config.extraBody ?? {};
    this.maxTemperature = config.maxTemperature ?? 2;
    this.apiKey = apiKey || process.env[config.apiKeyEnv] || '';
    this.logger = createLogger(`Agent:${config.displayName}`);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  listModels(): string[] {
    return [...this.models];
  }

  setModels(models: string[]): void {
    if (models.length > 0) this.models = [...models];
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError(this.name, 'API key not configured');
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role };
        // Multimodal: if message has imageData, use content array format
        if (m.imageData && m.role === 'user') {
          msg['content'] = [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.imageData.mimeType};base64,${m.imageData.base64}` } },
          ];
        } else {
          msg['content'] = m.content;
        }
        if (m.tool_call_id) msg['tool_call_id'] = m.tool_call_id;
        if (m.tool_calls) msg['tool_calls'] = m.tool_calls;
        return msg;
      }),
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = Math.min(request.temperature, this.maxTemperature);
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    Object.assign(body, this.extraBody);

    this.logger.debug('Request', { model: request.model, tools: request.tools?.length ?? 0 });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      throw new LLMProviderError(this.name, `API error ${response.status}: ${errorText}`, response.status, retryable);
    }

    const rawText = await response.text();
    let data: OpenAICompatibleResponse;
    try {
      data = JSON.parse(rawText) as OpenAICompatibleResponse;
    } catch (parseErr) {
      this.logger.error('Failed to parse API response', {
        responseLength: rawText.length,
        preview: rawText.substring(0, 500),
        error: (parseErr as Error).message,
      });
      throw new LLMProviderError(
        this.name,
        `Invalid JSON response (${rawText.length} chars): ${(parseErr as Error).message}`,
        undefined,
        true,
      );
    }
    const choice = data.choices[0];

    if (!choice) {
      throw new LLMProviderError(this.name, 'No choices in response');
    }

    this.logger.debug('Response', {
      model: data.model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    });

    // Support reasoning_content (e.g. Kimi K2.5 thinking mode)
    const content = choice.message.content || choice.message.reasoning_content || '';

    // Parse tool_calls if present (with safe parsing for truncated responses)
    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeJsonParse(tc.function.arguments, `tool:${tc.function.name}`, this.logger),
    }));

    return {
      id: data.id || generateId('msg'),
      model: data.model,
      provider: this.name,
      content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError(this.name, 'API key not configured');
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role };
        if (m.imageData && m.role === 'user') {
          msg['content'] = [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.imageData.mimeType};base64,${m.imageData.base64}` } },
          ];
        } else {
          msg['content'] = m.content;
        }
        return msg;
      }),
      stream: true,
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = Math.min(request.temperature, this.maxTemperature);
    Object.assign(body, this.extraBody);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new LLMProviderError(this.name, `Stream error ${response.status}: ${errorText}`, response.status);
    }

    let fullContent = '';
    let model = request.model;
    let promptTokens = 0;
    let completionTokens = 0;
    let responseId = generateId('msg');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const chunk = JSON.parse(jsonStr) as OpenAICompatibleStreamChunk;
            responseId = chunk.id || responseId;
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
            // skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: responseId,
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
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }
}
