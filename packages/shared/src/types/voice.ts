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

// ─── Wake Word ─────────────────────────────────────

export type WakeWordEngine = 'porcupine' | 'custom';

export interface WakeWordConfig {
  enabled: boolean;
  engine: WakeWordEngine;
  /** Picovoice AccessKey (required for Porcupine) */
  accessKey?: string;
  /** Wake word keyword — built-in or custom .ppn path */
  keyword: string;
  /** Sensitivity 0.0–1.0 (higher = more sensitive, more false positives) */
  sensitivity: number;
  /** After wake word detected, how many seconds to listen for a command */
  listenDurationSec: number;
  /** Play a confirmation sound/chime when wake word is detected */
  confirmationSound: boolean;
  /** Auto-send the transcribed command to the agent after wake word + speech */
  autoSendToAgent: boolean;
  /** Session ID to use for wake word conversations */
  sessionId?: string;
}

export interface WakeWordEvent {
  type: 'wake_word_detected' | 'listening_started' | 'listening_stopped' | 'command_captured' | 'error';
  timestamp: string;
  keyword?: string;
  /** Transcribed command text (only for command_captured) */
  transcript?: string;
  /** Confidence score from STT */
  confidence?: number;
  error?: string;
}

export interface WakeWordStatus {
  enabled: boolean;
  running: boolean;
  engine: WakeWordEngine;
  keyword: string;
  sensitivity: number;
  detectionCount: number;
  lastDetection?: string;
  uptime: number;
}
