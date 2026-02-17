import { OpenAICompatibleProvider } from './openai-compatible.js';

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: 'groq',
      displayName: 'Groq',
      baseUrl: 'https://api.groq.com/openai',
      apiKeyEnv: 'GROQ_API_KEY',
      models: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama-3.2-90b-vision-preview',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
      ],
    }, apiKey);
  }
}
