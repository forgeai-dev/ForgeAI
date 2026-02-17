import { OpenAICompatibleProvider } from './openai-compatible.js';

export class XAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'xai',
      displayName: 'xAI (Grok)',
      baseUrl: 'https://api.x.ai',
      apiKeyEnv: 'XAI_API_KEY',
      models: [
        'grok-3',
        'grok-3-mini',
        'grok-2',
        'grok-2-mini',
      ],
    }, apiKey);
  }
}
