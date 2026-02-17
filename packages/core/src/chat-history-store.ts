import { resolve } from 'node:path';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:ChatHistoryStore');

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  provider?: string;
  duration?: number;
  tokens?: number;
  blocked?: boolean;
  blockReason?: string;
  steps?: AgentStep[];
  timestamp: string;
}

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'status';
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  duration?: number;
  message: string;
  timestamp: string;
}

export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: StoredMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
}

export class ChatHistoryStore {
  private dir: string;

  constructor(baseDir?: string) {
    this.dir = baseDir || resolve(process.cwd(), '.forgeai', 'chat-sessions');
    this.ensureDir();
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private sessionPath(sessionId: string): string {
    // Sanitize sessionId for filesystem
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(this.dir, `${safe}.json`);
  }

  async saveMessage(sessionId: string, message: StoredMessage): Promise<void> {
    const session = await this.loadSession(sessionId);

    if (!session) {
      // New session — create with auto-title from first user message
      const title = message.role === 'user'
        ? message.content.substring(0, 80) + (message.content.length > 80 ? '...' : '')
        : 'New conversation';

      const newSession: StoredSession = {
        id: sessionId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 1,
        messages: [message],
      };

      await this.writeSession(newSession);
      logger.debug('New session created', { sessionId, title });
    } else {
      session.messages.push(message);
      session.messageCount = session.messages.length;
      session.updatedAt = new Date().toISOString();
      await this.writeSession(session);
    }
  }

  async loadSession(sessionId: string): Promise<StoredSession | null> {
    const path = this.sessionPath(sessionId);
    if (!existsSync(path)) return null;

    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as StoredSession;
    } catch (error) {
      logger.error('Failed to load session', error, { sessionId });
      return null;
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureDir();

    try {
      const files = await readdir(this.dir);
      const sessions: SessionSummary[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(resolve(this.dir, file), 'utf-8');
          const session = JSON.parse(data) as StoredSession;
          const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user');
          sessions.push({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messageCount,
            lastMessage: lastUserMsg?.content?.substring(0, 100),
          });
        } catch { /* skip corrupted files */ }
      }

      // Sort by updatedAt desc
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return sessions;
    } catch (error) {
      logger.error('Failed to list sessions', error);
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const path = this.sessionPath(sessionId);
    if (!existsSync(path)) return false;

    try {
      await unlink(path);
      logger.info('Session deleted', { sessionId });
      return true;
    } catch (error) {
      logger.error('Failed to delete session', error, { sessionId });
      return false;
    }
  }

  async deleteAllSessions(): Promise<number> {
    await this.ensureDir();
    try {
      const files = await readdir(this.dir);
      let count = 0;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          await unlink(resolve(this.dir, file));
          count++;
        } catch { /* skip */ }
      }
      logger.info('All sessions deleted', { count });
      return count;
    } catch (error) {
      logger.error('Failed to delete all sessions', error);
      return 0;
    }
  }

  private async writeSession(session: StoredSession): Promise<void> {
    await this.ensureDir();
    const path = this.sessionPath(session.id);
    await writeFile(path, JSON.stringify(session, null, 2), 'utf-8');
  }
}

export function createChatHistoryStore(baseDir?: string): ChatHistoryStore {
  return new ChatHistoryStore(baseDir);
}
