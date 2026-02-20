export type TTSProvider = 'elevenlabs' | 'openai' | 'browser' | 'piper' | 'kokoro';
export type STTProvider = 'whisper' | 'whisper-local' | 'whisper-vps' | 'openai' | 'browser';

export interface TTSRequest {
  text: string;
  provider?: TTSProvider;
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'wav' | 'ogg';
}

export interface TTSResponse {
  audio: Buffer | ArrayBuffer;
  format: string;
  durationMs: number;
  provider: TTSProvider;
  charCount: number;
}

export interface STTRequest {
  audio: Buffer | ArrayBuffer;
  provider?: STTProvider;
  language?: string;
  format?: string;
}

export interface STTResponse {
  text: string;
  confidence: number;
  language: string;
  durationMs: number;
  provider: STTProvider;
}

export interface VoiceConfig {
  ttsProvider: TTSProvider;
  sttProvider: STTProvider;
  ttsVoice: string;
  ttsSpeed: number;
  language: string;
  enabled: boolean;
}
