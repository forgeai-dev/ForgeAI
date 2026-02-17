import { createLogger, generateId } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';
import type { LLMProviderAdapter } from './base.js';
import { LLMProviderError } from './base.js';

const logger = createLogger('Agent:Anthropic');

const ANTHROPIC_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
];

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
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
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env['ANTHROPIC_API_KEY'] || '';
    this.baseUrl = baseUrl || 'https://api.anthropic.com';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  listModels(): string[] {
    return [...ANTHROPIC_MODELS];
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
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
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content,
      }));
  }
}
