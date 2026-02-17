import { OpenAICompatibleProvider } from './openai-compatible.js';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: [
        'deepseek-chat',
        'deepseek-coder',
        'deepseek-reasoner',
      ],
    }, apiKey);
  }
}
