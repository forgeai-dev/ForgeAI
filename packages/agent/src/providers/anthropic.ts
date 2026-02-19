import { createLogger, generateId } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';
import type { LLMProviderAdapter } from './base.js';
import { LLMProviderError } from './base.js';

const logger = createLogger('Agent:Anthropic');

const ANTHROPIC_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
];

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  message?: AnthropicResponse;
  index?: number;
  usage?: { output_tokens: number };
}

export class AnthropicProvider implements LLMProviderAdapter {
  readonly name: LLMProvider = 'anthropic';
  readonly displayName = 'Anthropic (Claude)';

  private apiKey: string;
  private oauthToken: string;
  private baseUrl: string;
  private customModels: string[] | null = null;

  constructor(apiKey?: string, baseUrl?: string) {
    const key = apiKey || process.env['ANTHROPIC_API_KEY'] || '';
    // Auto-detect OAuth tokens (sk-ant-oat01-*) vs regular API keys (sk-ant-api03-*)
    if (key.startsWith('sk-ant-oat01-')) {
      this.oauthToken = key;
      this.apiKey = '';
      logger.info('Anthropic: using OAuth token (subscription plan: Pro/Max/CLI)');
    } else {
      this.apiKey = key;
      this.oauthToken = '';
    }
    this.baseUrl = baseUrl || 'https://api.anthropic.com';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 || this.oauthToken.length > 0;
  }

  /** Returns true if using an OAuth subscription token instead of a standard API key */
  isOAuth(): boolean {
    return this.oauthToken.length > 0;
  }

  /** Build auth headers based on token type */
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.oauthToken) {
      // OAuth tokens use Bearer auth (Claude Pro/Max/CLI subscription)
      headers['Authorization'] = `Bearer ${this.oauthToken}`;
    } else {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  listModels(): string[] {
    return this.customModels ? [...this.customModels] : [...ANTHROPIC_MODELS];
  }

  setModels(models: string[]): void {
    if (models.length > 0) this.customModels = [...models];
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError('anthropic', 'API key not configured');
    }

    const messages = this.convertMessages(request.messages);
    const systemPrompt = request.messages.find(m => m.role === 'system')?.content;

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages,
    };

    if (systemPrompt) {
      body['system'] = systemPrompt;
    }
    if (request.temperature !== undefined) {
      body['temperature'] = request.temperature;
    }

    logger.debug('Anthropic request', { model: request.model });

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      // Detect OAuth-specific errors and provide actionable message
      if (this.oauthToken && (response.status === 401 || response.status === 403)) {
        throw new LLMProviderError('anthropic', `OAuth token error (${response.status}): ${errorText}. OAuth subscription tokens may be temporarily unsupported by Anthropic. Use a standard API key from console.anthropic.com as fallback.`, response.status, false);
      }
      throw new LLMProviderError('anthropic', `API error ${response.status}: ${errorText}`, response.status, retryable);
    }

    const data = await response.json() as AnthropicResponse;
    const content = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    logger.debug('Anthropic response', {
      model: data.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    });

    return {
      id: data.id,
      model: data.model,
      provider: 'anthropic',
      content,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError('anthropic', 'API key not configured');
    }

    const messages = this.convertMessages(request.messages);
    const systemPrompt = request.messages.find(m => m.role === 'system')?.content;

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages,
      stream: true,
    };

    if (systemPrompt) body['system'] = systemPrompt;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      if (this.oauthToken && (response.status === 401 || response.status === 403)) {
        throw new LLMProviderError('anthropic', `OAuth stream error (${response.status}): ${errorText}. OAuth subscription tokens may be temporarily unsupported. Use a standard API key from console.anthropic.com.`, response.status);
      }
      throw new LLMProviderError('anthropic', `Stream error ${response.status}: ${errorText}`, response.status);
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let model = request.model;

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
            const event = JSON.parse(jsonStr) as AnthropicStreamEvent;

            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullContent += event.delta.text;
              yield event.delta.text;
            }

            if (event.type === 'message_start' && event.message) {
              model = event.message.model;
              inputTokens = event.message.usage.input_tokens;
            }

            if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens;
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
      id: generateId('msg'),
      model,
      provider: 'anthropic',
      content: fullContent,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: 'stop',
    };
  }

  private convertMessages(messages: LLMRequest['messages']): AnthropicMessage[] {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'assistant' as const : 'user' as const;
        // Multimodal: if message has imageData, use Anthropic content block format
        if (m.imageData && m.role === 'user') {
          return {
            role,
            content: [
              { type: 'image', source: { type: 'base64', media_type: m.imageData.mimeType, data: m.imageData.base64 } },
              { type: 'text', text: m.content },
            ],
          };
        }
        return { role, content: m.content };
      });
  }
}
