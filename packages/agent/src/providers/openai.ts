import { createLogger, generateId } from '@forgeai/shared';
import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';
import type { LLMProviderAdapter } from './base.js';
import { LLMProviderError } from './base.js';

const logger = createLogger('Agent:OpenAI');

const OPENAI_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'o1',
  'o1-mini',
  'o3-mini',
];

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
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

export class OpenAIProvider implements LLMProviderAdapter {
  readonly name: LLMProvider = 'openai';
  readonly displayName = 'OpenAI (GPT)';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env['OPENAI_API_KEY'] || '';
    this.baseUrl = baseUrl || 'https://api.openai.com';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  listModels(): string[] {
    return [...OPENAI_MODELS];
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError('openai', 'API key not configured');
    }

    const messages = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    logger.debug('OpenAI request', { model: request.model });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      throw new LLMProviderError('openai', `API error ${response.status}: ${errorText}`, response.status, retryable);
    }

    const data = await response.json() as OpenAIResponse;
    const choice = data.choices[0];

    if (!choice) {
      throw new LLMProviderError('openai', 'No choices in response');
    }

    logger.debug('OpenAI response', {
      model: data.model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    });

    return {
      id: data.id,
      model: data.model,
      provider: 'openai',
      content: choice.message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    if (!this.isConfigured()) {
      throw new LLMProviderError('openai', 'API key not configured');
    }

    const messages = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.maxTokens) body['max_tokens'] = request.maxTokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new LLMProviderError('openai', `Stream error ${response.status}: ${errorText}`, response.status);
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
            const chunk = JSON.parse(jsonStr) as OpenAIStreamChunk;
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
      provider: 'openai',
      content: fullContent,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: 'stop',
    };
  }

  private convertMessages(messages: LLMRequest['messages']): OpenAIMessage[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
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
