import type { Session, SessionStatus, ChannelType } from '@forgeai/shared';
import { createLogger, generateId, SESSION_MAX_IDLE_MS } from '@forgeai/shared';

const logger = createLogger('Core:SessionManager');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupIdleSessions(), 60_000);
    logger.info('Session manager initialized');
  }

  create(params: {
    userId: string;
    agentId: string;
    channelId: string;
    channelType: ChannelType;
    sandboxed?: boolean;
    metadata?: Record<string, unknown>;
  }): Session {
    const session: Session = {
      id: generateId('sess'),
      userId: params.userId,
      agentId: params.agentId,
      channelId: params.channelId,
      channelType: params.channelType,
      status: 'active',
      sandboxed: params.sandboxed ?? true,
      metadata: params.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.sessions.set(session.id, session);
    logger.info('Session created', { sessionId: session.id, channelType: session.channelType });
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getByUser(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId);
  }

  getByChannel(channelType: ChannelType, channelId: string): Session | undefined {
    return Array.from(this.sessions.values()).find(
      s => s.channelType === channelType && s.channelId === channelId && s.status === 'active'
    );
  }

  getActive(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  updateStatus(sessionId: string, status: SessionStatus): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = status;
    session.updatedAt = new Date();
    logger.debug('Session status updated', { sessionId, status });
    return true;
  }

  touch(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.lastActivityAt = new Date();
    session.updatedAt = new Date();
    return true;
  }

  close(sessionId: string): boolean {
    return this.updateStatus(sessionId, 'closed');
  }

  suspend(sessionId: string): boolean {
    return this.updateStatus(sessionId, 'suspended');
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (session.status !== 'active') continue;

      const idleTime = now - session.lastActivityAt.getTime();
      if (idleTime > SESSION_MAX_IDLE_MS) {
        session.status = 'idle';
        session.updatedAt = new Date();
        cleaned++;
        logger.debug('Session marked idle', { sessionId: id, idleMs: idleTime });
      }
    }

    if (cleaned > 0) {
      logger.info('Idle sessions cleaned', { count: cleaned });
    }
  }

  getStats(): { total: number; active: number; idle: number; closed: number; suspended: number } {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'active').length,
      idle: sessions.filter(s => s.status === 'idle').length,
      closed: sessions.filter(s => s.status === 'closed').length,
      suspended: sessions.filter(s => s.status === 'suspended').length,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    logger.info('Session manager destroyed');
  }
}

export function createSessionManager(): SessionManager {
  return new SessionManager();
}
