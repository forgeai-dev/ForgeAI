import { OpenAICompatibleProvider } from './openai-compatible.js';

export class XAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'xai',
      displayName: 'xAI (Grok)',
      baseUrl: 'https://api.x.ai',
      apiKeyEnv: 'XAI_API_KEY',
      models: [
        'grok-4',
        'grok-3',
        'grok-3-mini',
        'grok-2',
      ],
    }, apiKey);
  }

  // xAI billing requires a separate Management API key (not regular API key)
  // Balance check is not supported via the standard API key endpoint
}
