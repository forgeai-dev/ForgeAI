import { createLogger } from '@forgeai/shared';
import type { WakeWordConfig, WakeWordEvent, WakeWordStatus, WakeWordEngine } from '@forgeai/shared';

const logger = createLogger('Agent:WakeWord');

// ─── Types ─────────────────────────────────────────

export type WakeWordEventHandler = (event: WakeWordEvent) => void | Promise<void>;

export interface WakeWordDetector {
  readonly engine: WakeWordEngine;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  /** Process a 16kHz mono Int16 PCM frame (512 samples = 32ms at 16kHz) */
  processFrame(frame: Int16Array): Promise<boolean>;
  getFrameLength(): number;
  getSampleRate(): number;
  cleanup(): void;
}

// ─── Porcupine Detector ────────────────────────────

class PorcupineDetector implements WakeWordDetector {
  readonly engine: WakeWordEngine = 'porcupine';
  private porcupine: any = null;
  private running = false;
  private accessKey: string;
  private keyword: string;
  private sensitivity: number;

  constructor(accessKey: string, keyword: string, sensitivity: number) {
    this.accessKey = accessKey;
    this.keyword = keyword;
    this.sensitivity = sensitivity;
  }

  async start(): Promise<void> {
    if (this.running) return;

    try {
      // Dynamic import — @picovoice/porcupine-node is an optional dependency
      const { Porcupine, BuiltinKeyword } = await import('@picovoice/porcupine-node');

      // Map string keyword to built-in enum or treat as custom .ppn path
      const builtinKeywords = Object.values(BuiltinKeyword) as string[];
      const keywordNormalized = this.keyword.toLowerCase().replace(/\s+/g, '_');

      if (builtinKeywords.includes(keywordNormalized)) {
        // Built-in keyword (e.g., "hey google", "alexa", "ok google", "picovoice", etc.)
        // For "hey forge" we use a custom .ppn, but for testing we can use built-in ones
        this.porcupine = new Porcupine(
          this.accessKey,
          [keywordNormalized as any],
          [this.sensitivity],
        );
      } else {
        // Custom keyword — path to .ppn file
        this.porcupine = new Porcupine(
          this.accessKey,
          [this.keyword],
          [this.sensitivity],
        );
      }

      this.running = true;
      logger.info('Porcupine wake word detector started', { keyword: this.keyword, sensitivity: this.sensitivity });
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'Porcupine not installed. Run: pnpm add @picovoice/porcupine-node\n' +
          'Get a free AccessKey at https://console.picovoice.ai/',
        );
      }
      throw new Error(`Failed to initialize Porcupine: ${error.message}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info('Porcupine wake word detector stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async processFrame(frame: Int16Array): Promise<boolean> {
    if (!this.porcupine || !this.running) return false;

    try {
      const keywordIndex = this.porcupine.process(frame);
      return keywordIndex >= 0;
    } catch (error) {
      logger.error('Porcupine frame processing error', error);
      return false;
    }
  }

  getFrameLength(): number {
    return this.porcupine?.frameLength ?? 512;
  }

  getSampleRate(): number {
    return this.porcupine?.sampleRate ?? 16000;
  }

  cleanup(): void {
    if (this.porcupine) {
      try {
        this.porcupine.release();
      } catch { /* ignore */ }
      this.porcupine = null;
    }
    this.running = false;
  }
}

// ─── Custom Energy-Based Detector (fallback, no API key needed) ───

class CustomEnergyDetector implements WakeWordDetector {
  readonly engine: WakeWordEngine = 'custom';
  private running = false;
  private sensitivity: number;
  private energyThreshold: number;
  private consecutiveFrames = 0;
  private readonly requiredFrames = 3;

  constructor(sensitivity: number) {
    this.sensitivity = sensitivity;
    // Lower sensitivity = higher threshold = fewer false positives
    this.energyThreshold = 2000 * (1.1 - sensitivity);
  }

  async start(): Promise<void> {
    this.running = true;
    this.consecutiveFrames = 0;
    logger.info('Custom energy-based wake word detector started (fallback mode)', { sensitivity: this.sensitivity });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.consecutiveFrames = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  async processFrame(frame: Int16Array): Promise<boolean> {
    if (!this.running) return false;

    // Simple energy-based voice activity detection
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      energy += frame[i] * frame[i];
    }
    energy = Math.sqrt(energy / frame.length);

    if (energy > this.energyThreshold) {
      this.consecutiveFrames++;
      if (this.consecutiveFrames >= this.requiredFrames) {
        this.consecutiveFrames = 0;
        return true;
      }
    } else {
      this.consecutiveFrames = Math.max(0, this.consecutiveFrames - 1);
    }

    return false;
  }

  getFrameLength(): number {
    return 512;
  }

  getSampleRate(): number {
    return 16000;
  }

  cleanup(): void {
    this.running = false;
    this.consecutiveFrames = 0;
  }
}

// ─── Wake Word Manager ─────────────────────────────

export class WakeWordManager {
  private config: WakeWordConfig;
  private detector: WakeWordDetector | null = null;
  private eventHandlers: WakeWordEventHandler[] = [];
  private detectionCount = 0;
  private lastDetection: string | null = null;
  private startedAt: number | null = null;

  // Audio recording state (after wake word detection)
  private isCapturing = false;
  private captureBuffer: Int16Array[] = [];
  private captureTimeout: ReturnType<typeof setTimeout> | null = null;
  private silenceFrames = 0;
  private readonly silenceThreshold = 500;
  private readonly maxSilenceFrames = 30; // ~1 second of silence at 32ms/frame

  constructor(config?: Partial<WakeWordConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      engine: config?.engine ?? 'porcupine',
      accessKey: config?.accessKey,
      keyword: config?.keyword ?? 'hey_forge',
      sensitivity: config?.sensitivity ?? 0.5,
      listenDurationSec: config?.listenDurationSec ?? 5,
      confirmationSound: config?.confirmationSound ?? true,
      autoSendToAgent: config?.autoSendToAgent ?? true,
      sessionId: config?.sessionId,
    };
  }

  getConfig(): WakeWordConfig {
    return { ...this.config };
  }

  setConfig(update: Partial<WakeWordConfig>): void {
    const wasEnabled = this.config.enabled;
    Object.assign(this.config, update);

    // If sensitivity or keyword changed while running, restart
    if (this.detector?.isRunning() && (update.sensitivity !== undefined || update.keyword !== undefined)) {
      this.stop().then(() => this.start()).catch(err => logger.error('Restart failed', err));
    }

    // If enabled changed
    if (update.enabled !== undefined && update.enabled !== wasEnabled) {
      if (update.enabled) {
        this.start().catch(err => logger.error('Auto-start failed', err));
      } else {
        this.stop().catch(err => logger.error('Auto-stop failed', err));
      }
    }
  }

  onEvent(handler: WakeWordEventHandler): void {
    this.eventHandlers.push(handler);
  }

  removeEventHandler(handler: WakeWordEventHandler): void {
    this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
  }

  private emitEvent(event: WakeWordEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) result.catch(err => logger.error('Event handler error', err));
      } catch (err) {
        logger.error('Event handler error (sync)', err);
      }
    }
  }

  async start(): Promise<void> {
    if (this.detector?.isRunning()) {
      logger.warn('Wake word detector already running');
      return;
    }

    // Clean up previous detector
    this.detector?.cleanup();

    // Select engine
    if (this.config.engine === 'porcupine' && this.config.accessKey) {
      this.detector = new PorcupineDetector(
        this.config.accessKey,
        this.config.keyword,
        this.config.sensitivity,
      );
    } else {
      // Fallback to custom energy-based detector
      if (this.config.engine === 'porcupine' && !this.config.accessKey) {
        logger.warn('Porcupine AccessKey not set — falling back to energy-based detector. Get a free key at https://console.picovoice.ai/');
      }
      this.detector = new CustomEnergyDetector(this.config.sensitivity);
    }

    try {
      await this.detector.start();
      this.startedAt = Date.now();
      this.emitEvent({
        type: 'listening_started',
        timestamp: new Date().toISOString(),
        keyword: this.config.keyword,
      });
      logger.info('Wake word detection started', {
        engine: this.detector.engine,
        keyword: this.config.keyword,
        sensitivity: this.config.sensitivity,
      });
    } catch (error: any) {
      this.emitEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.detector) return;

    await this.detector.stop();
    this.detector.cleanup();
    this.detector = null;
    this.startedAt = null;
    this.cancelCapture();

    this.emitEvent({
      type: 'listening_stopped',
      timestamp: new Date().toISOString(),
    });
    logger.info('Wake word detection stopped');
  }

  /**
   * Process an audio frame (16kHz mono Int16 PCM, 512 samples).
   * Called continuously from an audio input stream.
   * Returns true if wake word was detected in this frame.
   */
  async processAudioFrame(frame: Int16Array): Promise<boolean> {
    if (!this.detector?.isRunning()) return false;

    // If we're capturing post-wake-word audio, buffer it
    if (this.isCapturing) {
      this.captureBuffer.push(new Int16Array(frame));

      // Check for silence to end capture early
      let energy = 0;
      for (let i = 0; i < frame.length; i++) {
        energy += frame[i] * frame[i];
      }
      energy = Math.sqrt(energy / frame.length);

      if (energy < this.silenceThreshold) {
        this.silenceFrames++;
        if (this.silenceFrames >= this.maxSilenceFrames && this.captureBuffer.length > 10) {
          // End capture on silence
          this.finishCapture();
        }
      } else {
        this.silenceFrames = 0;
      }

      return false; // Don't detect wake word while capturing
    }

    // Check for wake word
    const detected = await this.detector.processFrame(frame);

    if (detected) {
      this.detectionCount++;
      this.lastDetection = new Date().toISOString();

      logger.info('Wake word detected!', {
        keyword: this.config.keyword,
        count: this.detectionCount,
      });

      this.emitEvent({
        type: 'wake_word_detected',
        timestamp: this.lastDetection,
        keyword: this.config.keyword,
      });

      // Start capturing audio for the command
      this.startCapture();

      return true;
    }

    return false;
  }

  private startCapture(): void {
    this.isCapturing = true;
    this.captureBuffer = [];
    this.silenceFrames = 0;

    // Set max capture duration timeout
    this.captureTimeout = setTimeout(() => {
      this.finishCapture();
    }, this.config.listenDurationSec * 1000);
  }

  private finishCapture(): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }

    // Merge captured frames into a single buffer
    const totalLength = this.captureBuffer.reduce((sum, f) => sum + f.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const frame of this.captureBuffer) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    this.captureBuffer = [];

    // Emit command_captured event with the raw audio
    // The chat-routes handler will do the STT transcription
    if (totalLength > 0) {
      // Convert Int16Array to Buffer for STT processing
      const audioBuffer = Buffer.from(merged.buffer, merged.byteOffset, merged.byteLength);

      this.emitEvent({
        type: 'command_captured',
        timestamp: new Date().toISOString(),
        keyword: this.config.keyword,
      });

      // Store the audio buffer for retrieval by the API handler
      this._lastCapturedAudio = audioBuffer;
    }
  }

  private cancelCapture(): void {
    this.isCapturing = false;
    this.captureBuffer = [];
    if (this.captureTimeout) {
      clearTimeout(this.captureTimeout);
      this.captureTimeout = null;
    }
  }

  /** Last captured audio after wake word — consumed by API handler for STT */
  _lastCapturedAudio: Buffer | null = null;

  consumeCapturedAudio(): Buffer | null {
    const audio = this._lastCapturedAudio;
    this._lastCapturedAudio = null;
    return audio;
  }

  getStatus(): WakeWordStatus {
    return {
      enabled: this.config.enabled,
      running: this.detector?.isRunning() ?? false,
      engine: this.detector?.engine ?? this.config.engine,
      keyword: this.config.keyword,
      sensitivity: this.config.sensitivity,
      detectionCount: this.detectionCount,
      lastDetection: this.lastDetection ?? undefined,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
    };
  }

  getFrameLength(): number {
    return this.detector?.getFrameLength() ?? 512;
  }

  getSampleRate(): number {
    return this.detector?.getSampleRate() ?? 16000;
  }

  isRunning(): boolean {
    return this.detector?.isRunning() ?? false;
  }

  cleanup(): void {
    this.detector?.cleanup();
    this.detector = null;
    this.cancelCapture();
    this.eventHandlers = [];
    this.startedAt = null;
  }
}

// ─── Factory ───────────────────────────────────────

export function createWakeWordManager(config?: Partial<WakeWordConfig>): WakeWordManager {
  return new WakeWordManager(config);
}
