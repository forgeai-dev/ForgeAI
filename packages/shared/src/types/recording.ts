// ─── Session Recording & Replay ──────────────────────────────

/** A single recorded event in a session timeline */
export interface RecordingEvent {
  /** Monotonic offset in ms from recording start */
  offset: number;
  /** Event category */
  category: 'message' | 'step' | 'progress' | 'tool' | 'system';
  /** Event type within category */
  type: string;
  /** Event payload */
  data: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

/** Full session recording */
export interface SessionRecording {
  id: string;
  sessionId: string;
  title: string;
  channelType?: string;
  userId?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  /** Total duration in ms */
  duration: number;
  /** Total events count */
  eventCount: number;
  /** Timeline of all events */
  events: RecordingEvent[];
  /** Summary stats */
  stats: RecordingStats;
  startedAt: string;
  completedAt?: string;
  status: 'recording' | 'completed' | 'failed';
}

/** Recording statistics */
export interface RecordingStats {
  messageCount: number;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: number;
  thinkingSteps: number;
  totalTokens: number;
  toolsUsed: string[];
  iterations: number;
}

/** Summary for listing recordings (without full events) */
export interface RecordingSummary {
  id: string;
  sessionId: string;
  title: string;
  channelType?: string;
  duration: number;
  eventCount: number;
  stats: RecordingStats;
  startedAt: string;
  completedAt?: string;
  status: 'recording' | 'completed' | 'failed';
}
