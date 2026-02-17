import { OpenAICompatibleProvider } from './openai-compatible.js';

export class MistralProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'mistral',
      displayName: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai',
      apiKeyEnv: 'MISTRAL_API_KEY',
      models: [
        'mistral-large-latest',
        'mistral-medium-latest',
        'mistral-small-latest',
        'codestral-latest',
        'open-mistral-nemo',
        'pixtral-large-latest',
      ],
    }, apiKey);
  }
}
