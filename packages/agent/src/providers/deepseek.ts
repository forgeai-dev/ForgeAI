import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderBalance } from './base.js';
import type { LLMRequest, LLMResponse } from '@forgeai/shared';

const DEEPSEEK_MAX_TOKENS = 8192;

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: [
        'deepseek-chat',
        'deepseek-reasoner',
      ],
    }, apiKey);
  }

  private clampRequest(request: LLMRequest): LLMRequest {
    if (request.maxTokens && request.maxTokens > DEEPSEEK_MAX_TOKENS) {
      return { ...request, maxTokens: DEEPSEEK_MAX_TOKENS };
    }
    return request;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    return super.chat(this.clampRequest(request));
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string, LLMResponse> {
    return yield* super.chatStream(this.clampRequest(request));
  }

  async getBalance(): Promise<ProviderBalance> {
    if (!this.isConfigured()) {
      return { provider: this.name, displayName: this.displayName, available: false };
    }
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${this.getApiKey()}` },
      });
      if (!res.ok) return { provider: this.name, displayName: this.displayName, available: false };
      const data = await res.json() as { balance_infos?: Array<{ currency: string; total_balance: string }> };
      const info = data.balance_infos?.[0];
      if (!info) return { provider: this.name, displayName: this.displayName, available: false };
      const balance = parseFloat(info.total_balance);
      const currency = info.currency === 'CNY' ? 'CNY' : 'USD';
      const balanceUsd = currency === 'CNY' ? balance * 0.14 : balance;
      return { provider: this.name, displayName: this.displayName, available: true, balance: balanceUsd, currency: 'USD', raw: data as Record<string, unknown> };
    } catch {
      return { provider: this.name, displayName: this.displayName, available: false };
    }
  }
}
