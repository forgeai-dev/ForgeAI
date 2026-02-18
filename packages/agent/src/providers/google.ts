import { OpenAICompatibleProvider } from './openai-compatible.js';

export class GoogleProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'google',
      displayName: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKeyEnv: 'GOOGLE_API_KEY',
      models: [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ],
    }, apiKey);
  }
}
