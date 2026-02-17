import { OpenAICompatibleProvider } from './openai-compatible.js';

export class MoonshotProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'moonshot',
      displayName: 'Kimi (Moonshot)',
      baseUrl: 'https://api.moonshot.ai',
      apiKeyEnv: 'MOONSHOT_API_KEY',
      models: [
        'kimi-k2.5',
        'kimi-k2-0711-preview',
        'kimi-k2-0905-preview',
        'moonshot-v1-auto',
        'moonshot-v1-8k',
        'moonshot-v1-32k',
        'moonshot-v1-128k',
      ],
      extraBody: { thinking: { type: 'disabled' } },
      maxTemperature: 0.6,
    }, apiKey);
  }
}
