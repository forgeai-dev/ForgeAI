import { createLogger } from '@forgeai/shared';
import type { TTSProvider, STTProvider, TTSRequest, TTSResponse, STTRequest, STTResponse, VoiceConfig } from '@forgeai/shared';

const logger = createLogger('Agent:VoiceEngine');

export interface TTSAdapter {
  readonly provider: TTSProvider;
  isConfigured(): boolean;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  listVoices(): Promise<{ id: string; name: string; language: string }[]>;
}

export interface STTAdapter {
  readonly provider: STTProvider;
  isConfigured(): boolean;
  transcribe(request: STTRequest): Promise<STTResponse>;
}

class OpenAITTSAdapter implements TTSAdapter {
  readonly provider: TTSProvider = 'openai';

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const start = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: request.text,
        voice: request.voice ?? 'alloy',
        speed: request.speed ?? 1.0,
        response_format: request.format ?? 'mp3',
      }),
    });

    if (!res.ok) throw new Error(`OpenAI TTS error: ${res.status} ${await res.text()}`);

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      format: request.format ?? 'mp3',
      durationMs: Date.now() - start,
      provider: 'openai',
      charCount: request.text.length,
    };
  }

  async listVoices() {
    return [
      { id: 'alloy', name: 'Alloy', language: 'en' },
      { id: 'echo', name: 'Echo', language: 'en' },
      { id: 'fable', name: 'Fable', language: 'en' },
      { id: 'onyx', name: 'Onyx', language: 'en' },
      { id: 'nova', name: 'Nova', language: 'en' },
      { id: 'shimmer', name: 'Shimmer', language: 'en' },
    ];
  }
}

class ElevenLabsTTSAdapter implements TTSAdapter {
  readonly provider: TTSProvider = 'elevenlabs';

  isConfigured(): boolean {
    return !!process.env.ELEVENLABS_API_KEY;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const start = Date.now();
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

    const voiceId = request.voice ?? '21m00Tcm4TlvDq8ikWAM';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) throw new Error(`ElevenLabs TTS error: ${res.status} ${await res.text()}`);

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      format: 'mp3',
      durationMs: Date.now() - start,
      provider: 'elevenlabs',
      charCount: request.text.length,
    };
  }

  async listVoices() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return [];
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
      });
      if (!res.ok) return [];
      const data = await res.json() as { voices: { voice_id: string; name: string; labels?: { language?: string } }[] };
      return data.voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        language: v.labels?.language ?? 'en',
      }));
    } catch {
      return [];
    }
  }
}

class OpenAISTTAdapter implements STTAdapter {
  readonly provider: STTProvider = 'whisper';

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const start = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

    const formData = new FormData();
    const blob = new Blob([request.audio], { type: `audio/${request.format ?? 'wav'}` });
    formData.append('file', blob, `audio.${request.format ?? 'wav'}`);
    formData.append('model', 'whisper-1');
    if (request.language) formData.append('language', request.language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`OpenAI Whisper error: ${res.status} ${await res.text()}`);

    const data = await res.json() as { text: string };
    return {
      text: data.text,
      confidence: 0.95,
      language: request.language ?? 'en',
      durationMs: Date.now() - start,
      provider: 'whisper',
    };
  }
}

export class VoiceEngine {
  private ttsAdapters: Map<TTSProvider, TTSAdapter> = new Map();
  private sttAdapters: Map<STTProvider, STTAdapter> = new Map();
  private config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = {
      ttsProvider: config?.ttsProvider ?? 'openai',
      sttProvider: config?.sttProvider ?? 'whisper',
      ttsVoice: config?.ttsVoice ?? 'alloy',
      ttsSpeed: config?.ttsSpeed ?? 1.0,
      language: config?.language ?? 'en',
      enabled: config?.enabled ?? false,
    };

    this.ttsAdapters.set('openai', new OpenAITTSAdapter());
    this.ttsAdapters.set('elevenlabs', new ElevenLabsTTSAdapter());
    this.sttAdapters.set('whisper', new OpenAISTTAdapter());
    this.sttAdapters.set('openai', new OpenAISTTAdapter());

    logger.info('Voice engine initialized', { tts: this.config.ttsProvider, stt: this.config.sttProvider });
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  setConfig(update: Partial<VoiceConfig>): void {
    Object.assign(this.config, update);
  }

  async speak(text: string, options?: Partial<TTSRequest>): Promise<TTSResponse> {
    const provider = options?.provider ?? this.config.ttsProvider;
    const adapter = this.ttsAdapters.get(provider);
    if (!adapter) throw new Error(`TTS provider '${provider}' not registered`);
    if (!adapter.isConfigured()) throw new Error(`TTS provider '${provider}' not configured (missing API key)`);

    return adapter.synthesize({
      text,
      provider,
      voice: options?.voice ?? this.config.ttsVoice,
      speed: options?.speed ?? this.config.ttsSpeed,
      format: options?.format ?? 'mp3',
    });
  }

  async listen(audio: Buffer | ArrayBuffer, options?: Partial<STTRequest>): Promise<STTResponse> {
    const provider = options?.provider ?? this.config.sttProvider;
    const adapter = this.sttAdapters.get(provider);
    if (!adapter) throw new Error(`STT provider '${provider}' not registered`);
    if (!adapter.isConfigured()) throw new Error(`STT provider '${provider}' not configured (missing API key)`);

    return adapter.transcribe({
      audio,
      provider,
      language: options?.language ?? this.config.language,
      format: options?.format,
    });
  }

  async listVoices(provider?: TTSProvider): Promise<{ id: string; name: string; language: string }[]> {
    const p = provider ?? this.config.ttsProvider;
    const adapter = this.ttsAdapters.get(p);
    if (!adapter) return [];
    return adapter.listVoices();
  }

  getAvailableProviders(): { tts: { provider: TTSProvider; configured: boolean }[]; stt: { provider: STTProvider; configured: boolean }[] } {
    return {
      tts: Array.from(this.ttsAdapters.entries()).map(([p, a]) => ({ provider: p, configured: a.isConfigured() })),
      stt: Array.from(this.sttAdapters.entries()).map(([p, a]) => ({ provider: p, configured: a.isConfigured() })),
    };
  }
}

export function createVoiceEngine(config?: Partial<VoiceConfig>): VoiceEngine {
  return new VoiceEngine(config);
}
