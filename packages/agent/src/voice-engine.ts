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

/** Piper TTS via VPS API — free, fast, Portuguese voice */
class PiperTTSAdapter implements TTSAdapter {
  readonly provider: TTSProvider = 'piper';

  private getConfig() {
    return {
      baseUrl: (process.env.PIPER_API_URL || 'http://167.86.85.73:5051').replace(/\/+$/, ''),
      apiKey: process.env.PIPER_API_KEY || process.env.STT_TTS_API_KEY || '',
    };
  }

  isConfigured(): boolean {
    const { baseUrl, apiKey } = this.getConfig();
    return !!baseUrl && !!apiKey;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const start = Date.now();
    const { baseUrl, apiKey } = this.getConfig();
    if (!apiKey) throw new Error('PIPER_API_KEY or STT_TTS_API_KEY not configured');

    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: request.text }),
    });

    if (!res.ok) throw new Error(`Piper TTS error: ${res.status} ${await res.text()}`);

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      format: 'wav',
      durationMs: Date.now() - start,
      provider: 'piper',
      charCount: request.text.length,
    };
  }

  async listVoices() {
    return [
      { id: 'faber', name: 'Faber (PT-BR)', language: 'pt-BR' },
    ];
  }
}

/** Kokoro voice prefix → language + gender label */
const KOKORO_PREFIX: Record<string, { lang: string; langLabel: string; gender: string }> = {
  af: { lang: 'en-US', langLabel: 'EN', gender: 'F' },
  am: { lang: 'en-US', langLabel: 'EN', gender: 'M' },
  bf: { lang: 'en-GB', langLabel: 'EN-GB', gender: 'F' },
  bm: { lang: 'en-GB', langLabel: 'EN-GB', gender: 'M' },
  ef: { lang: 'es', langLabel: 'ES', gender: 'F' },
  em: { lang: 'es', langLabel: 'ES', gender: 'M' },
  ff: { lang: 'fr', langLabel: 'FR', gender: 'F' },
  hf: { lang: 'hi', langLabel: 'HI', gender: 'F' },
  hm: { lang: 'hi', langLabel: 'HI', gender: 'M' },
  if: { lang: 'it', langLabel: 'IT', gender: 'F' },
  im: { lang: 'it', langLabel: 'IT', gender: 'M' },
  jf: { lang: 'ja', langLabel: 'JA', gender: 'F' },
  jm: { lang: 'ja', langLabel: 'JA', gender: 'M' },
  pf: { lang: 'pt-BR', langLabel: 'PT-BR', gender: 'F' },
  pm: { lang: 'pt-BR', langLabel: 'PT-BR', gender: 'M' },
  zf: { lang: 'zh', langLabel: 'ZH', gender: 'F' },
  zm: { lang: 'zh', langLabel: 'ZH', gender: 'M' },
};

/** Kokoro TTS via VPS API — high-quality, OpenAI-compatible, CPU-only */
class KokoroTTSAdapter implements TTSAdapter {
  readonly provider: TTSProvider = 'kokoro';
  private cachedVoiceIds: Set<string> | null = null;

  private getConfig() {
    return {
      baseUrl: (process.env.KOKORO_API_URL || 'http://167.86.85.73:8881').replace(/\/+$/, ''),
      apiKey: process.env.KOKORO_API_KEY || process.env.STT_TTS_API_KEY || '',
    };
  }

  isConfigured(): boolean {
    const { baseUrl, apiKey } = this.getConfig();
    return !!baseUrl && !!apiKey;
  }

  private async getValidVoice(requested?: string): Promise<string> {
    const fallback = 'pf_dora';
    if (!requested) return fallback;
    if (!this.cachedVoiceIds) {
      try {
        const voices = await this.listVoices();
        this.cachedVoiceIds = new Set(voices.map(v => v.id));
      } catch {
        this.cachedVoiceIds = new Set(this.defaultVoices().map(v => v.id));
      }
    }
    return this.cachedVoiceIds.has(requested) ? requested : fallback;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const start = Date.now();
    const { baseUrl, apiKey } = this.getConfig();
    if (!apiKey) throw new Error('KOKORO_API_KEY or STT_TTS_API_KEY not configured');

    const voice = await this.getValidVoice(request.voice);
    if (request.voice && request.voice !== voice) {
      logger.warn(`Kokoro: voice '${request.voice}' not found, using '${voice}'`);
    }

    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'kokoro',
        input: request.text,
        voice,
        speed: request.speed ?? 1.0,
        response_format: request.format ?? 'mp3',
      }),
    });

    if (!res.ok) throw new Error(`Kokoro TTS error: ${res.status} ${await res.text()}`);

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      format: request.format ?? 'mp3',
      durationMs: Date.now() - start,
      provider: 'kokoro',
      charCount: request.text.length,
    };
  }

  private parseVoice(id: string): { id: string; name: string; language: string } {
    const prefix = id.substring(0, 2);
    const meta = KOKORO_PREFIX[prefix];
    const rawName = id.substring(3);
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const isLegacy = rawName.startsWith('v0');
    const label = isLegacy
      ? `${displayName} [legacy] (${meta?.gender ?? '?'}, ${meta?.langLabel ?? '??'})`
      : `${displayName} (${meta?.gender ?? '?'}, ${meta?.langLabel ?? '??'})`;
    return { id, name: label, language: meta?.lang ?? 'en-US' };
  }

  async listVoices(): Promise<{ id: string; name: string; language: string }[]> {
    const { baseUrl, apiKey } = this.getConfig();
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(`${baseUrl}/v1/audio/voices`, { headers });
      if (!res.ok) return this.defaultVoices();
      const data = await res.json() as { voices: string[] };
      const voices = data.voices.map(v => this.parseVoice(v));
      voices.sort((a, b) => {
        const aIsPt = a.language === 'pt-BR' ? 0 : 1;
        const bIsPt = b.language === 'pt-BR' ? 0 : 1;
        if (aIsPt !== bIsPt) return aIsPt - bIsPt;
        return a.name.localeCompare(b.name);
      });
      return voices;
    } catch {
      return this.defaultVoices();
    }
  }

  private defaultVoices() {
    return [
      { id: 'pf_dora', name: 'Dora (F)', language: 'pt-BR' },
      { id: 'pm_alex', name: 'Alex (M)', language: 'pt-BR' },
      { id: 'pm_santa', name: 'Santa (M)', language: 'pt-BR' },
      { id: 'af_bella', name: 'Bella (F)', language: 'en-US' },
      { id: 'af_heart', name: 'Heart (F)', language: 'en-US' },
      { id: 'am_adam', name: 'Adam (M)', language: 'en-US' },
      { id: 'ef_dora', name: 'Dora ES (F)', language: 'es' },
    ];
  }
}

/** Whisper STT via VPS API — free, faster-whisper on VPS */
class VPSWhisperSTTAdapter implements STTAdapter {
  readonly provider: STTProvider = 'whisper-vps';

  private getConfig() {
    return {
      baseUrl: (process.env.WHISPER_API_URL || 'http://167.86.85.73:5051').replace(/\/+$/, ''),
      apiKey: process.env.WHISPER_API_KEY || process.env.STT_TTS_API_KEY || '',
    };
  }

  isConfigured(): boolean {
    const { baseUrl, apiKey } = this.getConfig();
    return !!baseUrl && !!apiKey;
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const start = Date.now();
    const { baseUrl, apiKey } = this.getConfig();
    if (!apiKey) throw new Error('WHISPER_API_KEY or STT_TTS_API_KEY not configured');

    const formData = new FormData();
    const blob = new Blob([request.audio], { type: `audio/${request.format ?? 'ogg'}` });
    formData.append('audio', blob, `audio.${request.format ?? 'ogg'}`);

    const res = await fetch(`${baseUrl}/stt`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`Whisper VPS error: ${res.status} ${await res.text()}`);

    const data = await res.json() as { text: string; language?: string };
    return {
      text: data.text,
      confidence: 0.95,
      language: data.language ?? request.language ?? 'pt',
      durationMs: Date.now() - start,
      provider: 'whisper-vps',
    };
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

/** Free local Whisper STT via @huggingface/transformers — no API key needed */
class LocalWhisperSTTAdapter implements STTAdapter {
  readonly provider: STTProvider = 'whisper-local';
  private pipeline: any = null;
  private loading: Promise<any> | null = null;

  isConfigured(): boolean {
    // Always available — no API key required
    return true;
  }

  private async getPipeline(): Promise<any> {
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      logger.info('Local Whisper: loading model (first time may download ~75MB)...');
      const { pipeline } = await import('@huggingface/transformers');
      const modelId = process.env.WHISPER_MODEL ?? 'onnx-community/whisper-tiny';
      this.pipeline = await pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q4',
        device: 'cpu',
      });
      logger.info('Local Whisper: model loaded', { model: modelId });
      return this.pipeline;
    })();

    return this.loading;
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const start = Date.now();

    const transcriber = await this.getPipeline();

    // Whisper expects Float32Array PCM at 16kHz mono
    // Use ffmpeg-static (bundled binary) to decode OGG/Opus → raw PCM
    const { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { execFileSync } = await import('child_process');

    const audioBuffer = request.audio instanceof ArrayBuffer
      ? Buffer.from(request.audio)
      : request.audio;

    const ext = request.format ?? 'ogg';
    const tempDir = mkdtempSync(join(tmpdir(), 'forgeai-stt-'));
    const inputFile = join(tempDir, `audio.${ext}`);
    const rawFile = join(tempDir, 'audio.raw');

    try {
      writeFileSync(inputFile, audioBuffer);

      // Get ffmpeg binary path from @ffmpeg-installer/ffmpeg (npm-bundled, no system install needed)
      const { path: ffmpegPath } = await import('@ffmpeg-installer/ffmpeg');

      // Convert any audio format → raw PCM Float32 Little-Endian, 16kHz, mono
      execFileSync(ffmpegPath, [
        '-i', inputFile,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'f32le',
        '-y', rawFile,
      ], { stdio: 'pipe' });

      // Read raw PCM and create Float32Array
      const rawBuffer = readFileSync(rawFile);
      const audioData = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);

      logger.info('Local Whisper: audio decoded', { samples: audioData.length, durationSec: (audioData.length / 16000).toFixed(1) });

      const result = await transcriber(audioData, {
        language: request.language ?? 'pt',
        task: 'transcribe',
        return_timestamps: false,
      });

      const text = typeof result === 'string' ? result : (result as any).text ?? '';

      return {
        text: text.trim(),
        confidence: 0.85,
        language: request.language ?? 'pt',
        durationMs: Date.now() - start,
        provider: 'whisper-local',
      };
    } finally {
      // Cleanup temp files
      try { unlinkSync(inputFile); } catch { /* ignore */ }
      try { unlinkSync(rawFile); } catch { /* ignore */ }
      try { rmdirSync(tempDir); } catch { /* ignore */ }
    }
  }
}

export class VoiceEngine {
  private ttsAdapters: Map<TTSProvider, TTSAdapter> = new Map();
  private sttAdapters: Map<STTProvider, STTAdapter> = new Map();
  private config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    // Auto-select STT: use OpenAI Whisper if key available, otherwise local (free)
    const defaultSTT: STTProvider = process.env.OPENAI_API_KEY ? 'whisper' : 'whisper-local';

    this.config = {
      ttsProvider: config?.ttsProvider ?? 'openai',
      sttProvider: config?.sttProvider ?? defaultSTT,
      ttsVoice: config?.ttsVoice ?? 'alloy',
      ttsSpeed: config?.ttsSpeed ?? 1.0,
      language: config?.language ?? 'pt',
      enabled: config?.enabled ?? false,
    };

    this.ttsAdapters.set('openai', new OpenAITTSAdapter());
    this.ttsAdapters.set('elevenlabs', new ElevenLabsTTSAdapter());
    this.ttsAdapters.set('piper', new PiperTTSAdapter());
    this.ttsAdapters.set('kokoro', new KokoroTTSAdapter());
    this.sttAdapters.set('whisper', new OpenAISTTAdapter());
    this.sttAdapters.set('openai', new OpenAISTTAdapter());
    this.sttAdapters.set('whisper-local', new LocalWhisperSTTAdapter());
    this.sttAdapters.set('whisper-vps', new VPSWhisperSTTAdapter());

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

  /** Strip markdown, emojis, tables, code blocks etc. for clean TTS reading */
  sanitizeForTTS(text: string): string {
    let clean = text;

    // Remove code blocks (```...```)
    clean = clean.replace(/```[\s\S]*?```/g, '');

    // Remove inline code (`...`)
    clean = clean.replace(/`([^`]+)`/g, '$1');

    // Remove markdown tables (lines starting with |)
    clean = clean.replace(/^\|.*\|$/gm, '');
    // Remove table separator lines (|---|---|)
    clean = clean.replace(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/gm, '');

    // Remove horizontal rules (---, ***, ___)
    clean = clean.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

    // Remove headings markers (# ## ### etc.) but keep the text
    clean = clean.replace(/^#{1,6}\s+/gm, '');

    // Remove bold/italic markers but keep text
    clean = clean.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    clean = clean.replace(/\*\*(.+?)\*\*/g, '$1');
    clean = clean.replace(/\*(.+?)\*/g, '$1');
    clean = clean.replace(/__(.+?)__/g, '$1');
    clean = clean.replace(/_(.+?)_/g, '$1');
    clean = clean.replace(/~~(.+?)~~/g, '$1');

    // Remove markdown links [text](url) → text
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove images ![alt](url)
    clean = clean.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Remove emojis (Unicode emoji ranges)
    clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu, '');

    // Remove bullet markers (- , * , + ) at start of line but keep text
    clean = clean.replace(/^\s*[-*+]\s+/gm, '');

    // Remove numbered list markers (1. 2. etc.)
    clean = clean.replace(/^\s*\d+\.\s+/gm, '');

    // Remove blockquote markers
    clean = clean.replace(/^\s*>\s?/gm, '');

    // Remove HTML tags
    clean = clean.replace(/<[^>]+>/g, '');

    // Remove arrows (→, ←, ↓, ↑)
    clean = clean.replace(/[→←↓↑]/g, '');

    // Collapse multiple newlines into one pause
    clean = clean.replace(/\n{2,}/g, '\n');

    // Remove lines that are empty or only whitespace
    clean = clean.split('\n').filter(l => l.trim().length > 0).join('. ');

    // Clean up multiple spaces
    clean = clean.replace(/\s{2,}/g, ' ');

    // Clean up multiple periods/dots
    clean = clean.replace(/\.{2,}/g, '.');
    clean = clean.replace(/\.\s*\./g, '.');

    return clean.trim();
  }

  async speak(text: string, options?: Partial<TTSRequest>): Promise<TTSResponse> {
    const provider = options?.provider ?? this.config.ttsProvider;
    const adapter = this.ttsAdapters.get(provider);
    if (!adapter) throw new Error(`TTS provider '${provider}' not registered`);
    if (!adapter.isConfigured()) throw new Error(`TTS provider '${provider}' not configured (missing API key)`);

    // Sanitize text for clean TTS reading
    const cleanText = this.sanitizeForTTS(text);
    logger.debug('TTS sanitized', { original: text.length, clean: cleanText.length });

    return adapter.synthesize({
      text: cleanText,
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
