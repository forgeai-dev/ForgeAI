import type { LLMRequest, LLMResponse, LLMProvider } from '@forgeai/shared';

export interface LLMProviderAdapter {
  readonly name: LLMProvider;
  readonly displayName: string;

  isConfigured(): boolean;
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse>;
  listModels(): string[];
}

export class LLMProviderError extends Error {
  public readonly provider: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(provider: string, message: string, statusCode?: number, retryable = false) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}
