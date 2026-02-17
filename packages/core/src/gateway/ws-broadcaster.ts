import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:WSBroadcaster');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WSSocket = any;

export interface WSClient {
  socket: WSSocket;
  subscribedSessions: Set<string>;
  connectedAt: number;
}

/**
 * WSBroadcaster manages WebSocket clients and broadcasts events
 * to clients subscribed to specific sessions.
 */
export class WSBroadcaster {
  private clients: Set<WSClient> = new Set();

  addClient(socket: WebSocket): WSClient {
    const client: WSClient = {
      socket,
      subscribedSessions: new Set(),
      connectedAt: Date.now(),
    };
    this.clients.add(client);
    logger.info(`WS client connected (total: ${this.clients.size})`);
    return client;
  }

  removeClient(client: WSClient): void {
    this.clients.delete(client);
    logger.info(`WS client disconnected (total: ${this.clients.size})`);
  }

  subscribe(client: WSClient, sessionId: string): void {
    client.subscribedSessions.add(sessionId);
    logger.debug(`WS client subscribed to session ${sessionId}`);
  }

  unsubscribe(client: WSClient, sessionId: string): void {
    client.subscribedSessions.delete(sessionId);
  }

  /**
   * Broadcast an event to all clients subscribed to a specific session.
   */
  broadcastToSession(sessionId: string, event: Record<string, unknown>): void {
    const message = JSON.stringify(event);
    let sent = 0;

    for (const client of this.clients) {
      if (client.subscribedSessions.has(sessionId) && client.socket.readyState === 1) {
        try {
          client.socket.send(message);
          sent++;
        } catch {
          // Client disconnected, will be cleaned up
        }
      }
    }

    if (sent > 0) {
      logger.debug(`Broadcast to ${sent} client(s) for session ${sessionId}`, { type: (event as Record<string, unknown>).type });
    }
  }

  /**
   * Broadcast to ALL connected clients (e.g., system events).
   */
  broadcastAll(event: Record<string, unknown>): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.socket.readyState === 1) {
        try { client.socket.send(message); } catch { /* ignore */ }
      }
    }
  }

  getStats(): { clients: number; subscriptions: number } {
    let subscriptions = 0;
    for (const client of this.clients) {
      subscriptions += client.subscribedSessions.size;
    }
    return { clients: this.clients.size, subscriptions };
  }
}

// Singleton instance
let broadcaster: WSBroadcaster | null = null;

export function getWSBroadcaster(): WSBroadcaster {
  if (!broadcaster) {
    broadcaster = new WSBroadcaster();
  }
  return broadcaster;
}
