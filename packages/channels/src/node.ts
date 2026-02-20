import { WebSocket, WebSocketServer } from 'ws';
import { generateId, createLogger } from '@forgeai/shared';
import type {
  InboundMessage,
  OutboundMessage,
  ConnectedNode,
  NodeProtocolMessage,
  NodeAuthMessage,
  NodePingMessage,
  NodeChatMessage,
  NodeCommandResultMessage,
  NodeEventMessage,
  NodeSysInfoMessage,
  NodeRelayMessage,
} from '@forgeai/shared';
import { BaseChannel } from './base.js';

const HEARTBEAT_INTERVAL = 30_000;  // 30s
const HEARTBEAT_TIMEOUT = 90_000;   // 90s — disconnect if no ping
const MAX_MESSAGE_SIZE = 1_048_576; // 1MB

export interface NodeChannelConfig {
  apiKey: string;        // shared secret for node auth
  maxNodes?: number;     // max concurrent connections (default: 100)
}

interface NodeConnection {
  ws: WebSocket;
  node: ConnectedNode;
  sessionId: string;
  authenticated: boolean;
}

const logger = createLogger('Channel:Node');

export class NodeChannel extends BaseChannel {
  private wss: WebSocketServer | null = null;
  private config: NodeChannelConfig;
  private connections: Map<string, NodeConnection> = new Map(); // nodeId → connection
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: NodeChannelConfig) {
    super('node');
    this.config = config;
  }

  // ─── WebSocket Handling ─────────────────────────────────

  /**
   * Handle a new WebSocket connection (called from Fastify WS route or standalone).
   * This is the primary integration point — call from a Fastify { websocket: true } route.
   */
  handleConnection(ws: WebSocket, ip?: string): void {
    this.ensureHeartbeat();
    logger.info('New node connection attempt', { ip: ip ?? 'unknown' });

    const tempId = generateId('ntmp');
    const conn: NodeConnection = {
      ws,
      node: {
        nodeId: tempId,
        name: 'pending',
        platform: 'unknown',
        version: '0.0.0',
        capabilities: [],
        status: 'offline',
        connectedAt: new Date(),
        lastPing: new Date(),
        latencyMs: 0,
      },
      sessionId: '',
      authenticated: false,
    };

    // Must authenticate within 10s
    const authTimeout = setTimeout(() => {
      if (!conn.authenticated) {
        this.sendToWs(ws, { type: 'auth_error', ts: Date.now(), reason: 'Authentication timeout' });
        ws.close(4001, 'Auth timeout');
      }
    }, 10_000);

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as NodeProtocolMessage;
        this.handleNodeMessage(conn, msg);
      } catch (err) {
        logger.error('Invalid message from node', err);
        this.sendToWs(ws, { type: 'error', ts: Date.now(), code: 'PARSE_ERROR', message: 'Invalid JSON' });
      }
    });

    ws.on('close', (code: number) => {
      clearTimeout(authTimeout);
      if (conn.authenticated && conn.node.nodeId) {
        logger.info('Node disconnected', { nodeId: conn.node.nodeId, name: conn.node.name, code });
        conn.node.status = 'offline';
        this.connections.delete(conn.node.nodeId);
        this.broadcastNodeList();
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('Node WebSocket error', err, { nodeId: conn.node.nodeId });
    });
  }

  /** Attach to an existing HTTP server (standalone mode — alternative to Fastify route) */
  attachToServer(server: import('http').Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws/node',
      maxPayload: MAX_MESSAGE_SIZE,
    });

    this.wss.on('connection', (ws: WebSocket, req: import('http').IncomingMessage) => {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
      this.handleConnection(ws, ip);
    });

    this._connected = true;
    logger.info('Node WebSocket server attached on /ws/node (standalone)');
  }

  private ensureHeartbeat(): void {
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL);
    }
    this._connected = true;
  }

  // ─── Message Router ────────────────────────────────────

  private handleNodeMessage(conn: NodeConnection, msg: NodeProtocolMessage): void {
    // Before auth, only accept auth messages
    if (!conn.authenticated && msg.type !== 'auth') {
      this.sendToWs(conn.ws, { type: 'auth_error', ts: Date.now(), reason: 'Not authenticated' });
      return;
    }

    switch (msg.type) {
      case 'auth':
        this.handleAuth(conn, msg as NodeAuthMessage);
        break;
      case 'ping':
        this.handlePing(conn, msg as NodePingMessage);
        break;
      case 'message':
        this.handleChatMessage(conn, msg as NodeChatMessage);
        break;
      case 'command_result':
        this.handleCommandResult(conn, msg as NodeCommandResultMessage);
        break;
      case 'event':
        this.handleEvent(conn, msg as NodeEventMessage);
        break;
      case 'sysinfo':
        this.handleSysInfo(conn, msg as NodeSysInfoMessage);
        break;
      case 'relay':
        this.handleRelay(conn, msg as NodeRelayMessage);
        break;
      default:
        this.sendToWs(conn.ws, { type: 'error', ts: Date.now(), code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msg.type}` });
    }
  }

  // ─── Auth ──────────────────────────────────────────────

  private handleAuth(conn: NodeConnection, msg: NodeAuthMessage): void {
    if (msg.token !== this.config.apiKey) {
      logger.warn('Node auth failed — invalid token', { nodeId: msg.node.nodeId });
      this.sendToWs(conn.ws, { type: 'auth_error', ts: Date.now(), reason: 'Invalid token' });
      conn.ws.close(4003, 'Invalid token');
      return;
    }

    const maxNodes = this.config.maxNodes ?? 100;
    if (this.connections.size >= maxNodes) {
      this.sendToWs(conn.ws, { type: 'auth_error', ts: Date.now(), reason: 'Max nodes reached' });
      conn.ws.close(4004, 'Max nodes');
      return;
    }

    // Check for duplicate nodeId — disconnect old one
    const existing = this.connections.get(msg.node.nodeId);
    if (existing) {
      logger.info('Replacing existing node connection', { nodeId: msg.node.nodeId });
      existing.ws.close(4005, 'Replaced by new connection');
      this.connections.delete(msg.node.nodeId);
    }

    const sessionId = generateId('nsess');
    conn.authenticated = true;
    conn.sessionId = sessionId;
    conn.node = {
      ...msg.node,
      status: 'online',
      connectedAt: new Date(),
      lastPing: new Date(),
      latencyMs: 0,
    };

    this.connections.set(msg.node.nodeId, conn);

    this.sendToWs(conn.ws, { type: 'auth_ok', ts: Date.now(), sessionId });
    logger.info('Node authenticated', {
      nodeId: msg.node.nodeId,
      name: msg.node.name,
      platform: msg.node.platform,
      capabilities: msg.node.capabilities,
    });

    this.broadcastNodeList();
  }

  // ─── Heartbeat ─────────────────────────────────────────

  private handlePing(conn: NodeConnection, msg: NodePingMessage): void {
    const now = Date.now();
    conn.node.lastPing = new Date(now);
    conn.node.latencyMs = now - msg.ts;
    this.sendToWs(conn.ws, { type: 'pong', ts: now });
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [nodeId, conn] of this.connections) {
      const elapsed = now - conn.node.lastPing.getTime();
      if (elapsed > HEARTBEAT_TIMEOUT) {
        logger.warn('Node heartbeat timeout', { nodeId, name: conn.node.name, elapsed });
        conn.node.status = 'offline';
        conn.ws.close(4006, 'Heartbeat timeout');
        this.connections.delete(nodeId);
        this.broadcastNodeList();
      }
    }
  }

  // ─── Chat (Node → AI) ─────────────────────────────────

  private async handleChatMessage(conn: NodeConnection, msg: NodeChatMessage): Promise<void> {
    const inbound: InboundMessage = {
      id: generateId('nmsg'),
      channelType: 'node',
      channelMessageId: msg.msgId ?? generateId('nmid'),
      senderId: conn.node.nodeId,
      senderName: conn.node.name,
      content: msg.content,
      replyToId: msg.replyTo,
      timestamp: new Date(msg.ts),
      raw: { nodeId: conn.node.nodeId, platform: conn.node.platform },
    };

    await this.handleInbound(inbound);
  }

  // ─── Command Results ───────────────────────────────────

  private commandCallbacks: Map<string, (result: NodeCommandResultMessage) => void> = new Map();

  private handleCommandResult(_conn: NodeConnection, msg: NodeCommandResultMessage): void {
    const cb = this.commandCallbacks.get(msg.msgId);
    if (cb) {
      cb(msg);
      this.commandCallbacks.delete(msg.msgId);
    } else {
      logger.warn('Unmatched command result', { msgId: msg.msgId });
    }
  }

  // ─── Events ────────────────────────────────────────────

  private handleEvent(conn: NodeConnection, msg: NodeEventMessage): void {
    logger.info('Node event', { nodeId: conn.node.nodeId, event: msg.name, data: msg.data });
    // Events can be forwarded to AI as context or stored
    // For now, create an inbound message so the AI knows about it
    const inbound: InboundMessage = {
      id: generateId('nevt'),
      channelType: 'node',
      channelMessageId: msg.msgId ?? generateId('neid'),
      senderId: conn.node.nodeId,
      senderName: conn.node.name,
      content: `[Node Event: ${msg.name}] ${JSON.stringify(msg.data)}`,
      timestamp: new Date(msg.ts),
      raw: { nodeId: conn.node.nodeId, eventName: msg.name, eventData: msg.data },
    };
    this.handleInbound(inbound);
  }

  // ─── System Info ───────────────────────────────────────

  private handleSysInfo(conn: NodeConnection, msg: NodeSysInfoMessage): void {
    conn.node.sysinfo = msg.info;
    logger.debug('Node sysinfo updated', { nodeId: conn.node.nodeId, cpu: msg.info.cpuPercent, mem: msg.info.memUsedMB });
  }

  // ─── Node-to-Node Relay ────────────────────────────────

  private handleRelay(conn: NodeConnection, msg: NodeRelayMessage): void {
    const target = this.connections.get(msg.targetNodeId);
    if (!target) {
      this.sendToWs(conn.ws, {
        type: 'error', ts: Date.now(),
        code: 'NODE_NOT_FOUND',
        message: `Target node '${msg.targetNodeId}' not connected`,
      });
      return;
    }

    // Forward with source info
    this.sendToWs(target.ws, {
      type: 'relay',
      ts: Date.now(),
      fromNodeId: conn.node.nodeId,
      targetNodeId: msg.targetNodeId,
      payload: msg.payload,
    });
  }

  // ─── Public API (used by Gateway/Dashboard) ────────────

  /** Send a command to a specific node and wait for result */
  async sendCommand(nodeId: string, cmd: string, args?: string[], timeoutMs = 30_000): Promise<NodeCommandResultMessage> {
    const conn = this.connections.get(nodeId);
    if (!conn) throw new Error(`Node '${nodeId}' not connected`);

    const msgId = generateId('ncmd');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commandCallbacks.delete(msgId);
        reject(new Error(`Command timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.commandCallbacks.set(msgId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.sendToWs(conn.ws, {
        type: 'command',
        ts: Date.now(),
        msgId,
        cmd,
        args,
        timeout: timeoutMs,
      });
    });
  }

  /** Get all connected nodes */
  getConnectedNodes(): ConnectedNode[] {
    return Array.from(this.connections.values())
      .filter(c => c.authenticated)
      .map(c => ({ ...c.node }));
  }

  /** Get a specific node */
  getNode(nodeId: string): ConnectedNode | undefined {
    const conn = this.connections.get(nodeId);
    return conn?.authenticated ? { ...conn.node } : undefined;
  }

  /** Send a raw message to a node */
  sendToNode(nodeId: string, msg: NodeProtocolMessage): boolean {
    const conn = this.connections.get(nodeId);
    if (!conn) return false;
    this.sendToWs(conn.ws, msg);
    return true;
  }

  // ─── Broadcast ─────────────────────────────────────────

  private broadcastNodeList(): void {
    const nodeList = this.getConnectedNodes().map(n => ({
      nodeId: n.nodeId,
      name: n.name,
      status: n.status,
      capabilities: n.capabilities,
    }));

    for (const conn of this.connections.values()) {
      if (conn.authenticated) {
        this.sendToWs(conn.ws, { type: 'node_list', ts: Date.now(), nodes: nodeList });
      }
    }
  }

  // ─── BaseChannel interface ─────────────────────────────

  async connect(): Promise<void> {
    // Connection is handled by attachToServer — this is a no-op
    logger.info('NodeChannel connect called (use attachToServer for WebSocket)');
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all node connections
    for (const conn of this.connections.values()) {
      conn.ws.close(1001, 'Server shutting down');
    }
    this.connections.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this._connected = false;
    logger.info('NodeChannel disconnected — all nodes dropped');
  }

  async send(message: OutboundMessage): Promise<void> {
    // recipientId is the nodeId
    const conn = this.connections.get(message.recipientId);
    if (!conn) {
      logger.warn('Cannot send — node not connected', { nodeId: message.recipientId });
      return;
    }

    this.sendToWs(conn.ws, {
      type: 'response',
      ts: Date.now(),
      content: message.content,
      replyTo: message.replyToId,
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  private sendToWs(ws: WebSocket, msg: NodeProtocolMessage | Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

export function createNodeChannel(config: NodeChannelConfig): NodeChannel {
  return new NodeChannel(config);
}
