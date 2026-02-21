import { resolve } from 'node:path';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createLogger, generateId } from '@forgeai/shared';
import type { SessionRecording, RecordingEvent, RecordingStats, RecordingSummary } from '@forgeai/shared';

const logger = createLogger('Core:SessionRecorder');

/** Active recording state (in-memory while recording) */
interface ActiveRecording {
  recording: SessionRecording;
  startTime: number;
}

export class SessionRecorder {
  private dir: string;
  private active: Map<string, ActiveRecording> = new Map();
  private listeners: Array<(event: string, recording: SessionRecording) => void> = [];

  constructor(baseDir?: string) {
    this.dir = baseDir || resolve(process.cwd(), '.forgeai', 'recordings');
    this.ensureDir();
    logger.info('Session recorder initialized', { dir: this.dir });
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  /** Start recording a session */
  startRecording(params: {
    sessionId: string;
    title?: string;
    channelType?: string;
    userId?: string;
    agentId?: string;
    model?: string;
    provider?: string;
  }): SessionRecording {
    const id = generateId('rec');
    const now = new Date();

    const recording: SessionRecording = {
      id,
      sessionId: params.sessionId,
      title: params.title || `Recording ${now.toLocaleString()}`,
      channelType: params.channelType,
      userId: params.userId,
      agentId: params.agentId,
      model: params.model,
      provider: params.provider,
      duration: 0,
      eventCount: 0,
      events: [],
      stats: {
        messageCount: 0,
        toolCalls: 0,
        toolSuccesses: 0,
        toolFailures: 0,
        thinkingSteps: 0,
        totalTokens: 0,
        toolsUsed: [],
        iterations: 0,
      },
      startedAt: now.toISOString(),
      status: 'recording',
    };

    this.active.set(params.sessionId, {
      recording,
      startTime: Date.now(),
    });

    logger.info('Recording started', { id, sessionId: params.sessionId });
    this.emit('recording.started', recording);
    return recording;
  }

  /** Add an event to an active recording */
  addEvent(sessionId: string, category: RecordingEvent['category'], type: string, data: Record<string, unknown>): void {
    const active = this.active.get(sessionId);
    if (!active) return;

    const offset = Date.now() - active.startTime;
    const event: RecordingEvent = {
      offset,
      category,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    active.recording.events.push(event);
    active.recording.eventCount = active.recording.events.length;
    active.recording.duration = offset;

    // Update stats
    this.updateStats(active.recording.stats, category, type, data);
  }

  /** Record a user message */
  recordMessage(sessionId: string, role: string, content: string, meta?: Record<string, unknown>): void {
    this.addEvent(sessionId, 'message', role, { content, ...meta });
  }

  /** Record an agent step (thinking, tool_call, tool_result) */
  recordStep(sessionId: string, stepType: string, data: Record<string, unknown>): void {
    this.addEvent(sessionId, 'step', stepType, data);
  }

  /** Record agent progress update */
  recordProgress(sessionId: string, data: Record<string, unknown>): void {
    this.addEvent(sessionId, 'progress', 'update', data);
  }

  /** Record tool execution */
  recordToolCall(sessionId: string, tool: string, args: Record<string, unknown>): void {
    this.addEvent(sessionId, 'tool', 'call', { tool, args });
  }

  recordToolResult(sessionId: string, tool: string, success: boolean, result: string, duration?: number): void {
    this.addEvent(sessionId, 'tool', 'result', { tool, success, result: result.substring(0, 2000), duration });
  }

  /** Record system event */
  recordSystem(sessionId: string, type: string, data: Record<string, unknown>): void {
    this.addEvent(sessionId, 'system', type, data);
  }

  /** Stop recording and persist to disk */
  async stopRecording(sessionId: string): Promise<SessionRecording | null> {
    const active = this.active.get(sessionId);
    if (!active) return null;

    active.recording.duration = Date.now() - active.startTime;
    active.recording.completedAt = new Date().toISOString();
    active.recording.status = 'completed';

    await this.saveRecording(active.recording);
    this.active.delete(sessionId);

    logger.info('Recording completed', {
      id: active.recording.id,
      sessionId,
      duration: active.recording.duration,
      events: active.recording.eventCount,
    });

    this.emit('recording.completed', active.recording);
    return active.recording;
  }

  /** Check if a session is being recorded */
  isRecording(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /** Get active recording for a session */
  getActive(sessionId: string): SessionRecording | null {
    return this.active.get(sessionId)?.recording || null;
  }

  /** Load a recording from disk */
  async getRecording(recordingId: string): Promise<SessionRecording | null> {
    const path = this.recordingPath(recordingId);
    if (!existsSync(path)) return null;

    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as SessionRecording;
    } catch (error) {
      logger.error('Failed to load recording', error, { recordingId });
      return null;
    }
  }

  /** List all recordings (summaries without full events) */
  async listRecordings(): Promise<RecordingSummary[]> {
    await this.ensureDir();
    try {
      const files = await readdir(this.dir);
      const summaries: RecordingSummary[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(resolve(this.dir, file), 'utf-8');
          const rec = JSON.parse(data) as SessionRecording;
          summaries.push({
            id: rec.id,
            sessionId: rec.sessionId,
            title: rec.title,
            channelType: rec.channelType,
            duration: rec.duration,
            eventCount: rec.eventCount,
            stats: rec.stats,
            startedAt: rec.startedAt,
            completedAt: rec.completedAt,
            status: rec.status,
          });
        } catch { /* skip corrupted */ }
      }

      summaries.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      return summaries;
    } catch (error) {
      logger.error('Failed to list recordings', error);
      return [];
    }
  }

  /** Delete a recording */
  async deleteRecording(recordingId: string): Promise<boolean> {
    const path = this.recordingPath(recordingId);
    if (!existsSync(path)) return false;
    try {
      await unlink(path);
      logger.info('Recording deleted', { recordingId });
      return true;
    } catch (error) {
      logger.error('Failed to delete recording', error, { recordingId });
      return false;
    }
  }

  /** Register event listener */
  onEvent(listener: (event: string, recording: SessionRecording) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: string, recording: SessionRecording): void {
    for (const listener of this.listeners) {
      try { listener(event, recording); } catch { /* ignore */ }
    }
  }

  private updateStats(stats: RecordingStats, category: string, type: string, data: Record<string, unknown>): void {
    if (category === 'message') {
      stats.messageCount++;
      if (data.tokens) stats.totalTokens += data.tokens as number;
    } else if (category === 'step') {
      if (type === 'thinking') stats.thinkingSteps++;
      if (type === 'tool_call') {
        stats.toolCalls++;
        const tool = data.tool as string | undefined;
        if (tool && !stats.toolsUsed.includes(tool)) {
          stats.toolsUsed.push(tool);
        }
      }
      if (type === 'tool_result') {
        if (data.success) stats.toolSuccesses++;
        else stats.toolFailures++;
      }
    } else if (category === 'progress') {
      const iteration = data.iteration as number | undefined;
      if (iteration && iteration > stats.iterations) {
        stats.iterations = iteration;
      }
    }
  }

  private recordingPath(recordingId: string): string {
    const safe = recordingId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(this.dir, `${safe}.json`);
  }

  private async saveRecording(recording: SessionRecording): Promise<void> {
    await this.ensureDir();
    const path = this.recordingPath(recording.id);
    await writeFile(path, JSON.stringify(recording, null, 2), 'utf-8');
  }
}

export function createSessionRecorder(baseDir?: string): SessionRecorder {
  return new SessionRecorder(baseDir);
}
