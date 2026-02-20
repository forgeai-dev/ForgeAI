/**
 * ForgeAI Node Protocol — WebSocket binary agent protocol
 * For lightweight devices: Raspberry Pi, ESP32, NanoKVM, etc.
 */

// ─── Node Identity ───────────────────────────────────────

export interface NodeInfo {
  nodeId: string;
  name: string;
  platform: string;        // 'linux-arm64', 'linux-amd64', 'esp32', etc.
  version: string;         // agent version
  capabilities: NodeCapability[];
  tags?: string[];          // user-defined tags: 'office', 'garage', 'server-room'
}

export type NodeCapability =
  | 'shell'        // can execute shell commands
  | 'sensor'       // has sensor data (temp, humidity, etc.)
  | 'gpio'         // GPIO pin control
  | 'camera'       // camera capture
  | 'display'      // has display output
  | 'audio'        // mic/speaker
  | 'file'         // file read/write
  | 'network'      // network diagnostics
  | 'docker'       // docker management
  | 'system';      // system info (cpu, ram, disk, uptime)

export type NodeStatus = 'online' | 'offline' | 'busy' | 'error';

export interface ConnectedNode extends NodeInfo {
  status: NodeStatus;
  connectedAt: Date;
  lastPing: Date;
  latencyMs: number;
  sysinfo?: NodeSystemInfo;
}

export interface NodeSystemInfo {
  cpuPercent: number;
  memTotalMB: number;
  memUsedMB: number;
  diskTotalGB: number;
  diskUsedGB: number;
  tempCelsius?: number;
  uptimeSeconds: number;
  hostname: string;
  ipAddress: string;
}

// ─── Protocol Messages ───────────────────────────────────

export type NodeMessageType =
  | 'auth'            // Node → GW: authenticate
  | 'auth_ok'         // GW → Node: auth success
  | 'auth_error'      // GW → Node: auth failed
  | 'ping'            // Node → GW: heartbeat
  | 'pong'            // GW → Node: heartbeat response
  | 'message'         // Node → GW: send message to AI
  | 'response'        // GW → Node: AI response
  | 'command'         // GW → Node: execute command on device
  | 'command_result'  // Node → GW: command result
  | 'event'           // Node → GW: sensor data, alert, etc.
  | 'sysinfo'         // Node → GW: system info update
  | 'relay'           // Node ↔ Node: message relay via GW
  | 'node_list'       // GW → Node: list of connected nodes
  | 'error';          // GW → Node: error message

export interface NodeMessageBase {
  type: NodeMessageType;
  ts: number;          // unix timestamp ms
  msgId?: string;      // optional message correlation ID
}

// Node → Gateway: Authenticate
export interface NodeAuthMessage extends NodeMessageBase {
  type: 'auth';
  token: string;
  node: NodeInfo;
}

// Gateway → Node: Auth success
export interface NodeAuthOkMessage extends NodeMessageBase {
  type: 'auth_ok';
  sessionId: string;
}

// Gateway → Node: Auth failed
export interface NodeAuthErrorMessage extends NodeMessageBase {
  type: 'auth_error';
  reason: string;
}

// Heartbeat
export interface NodePingMessage extends NodeMessageBase {
  type: 'ping';
}

export interface NodePongMessage extends NodeMessageBase {
  type: 'pong';
}

// Node → Gateway: Chat message to AI
export interface NodeChatMessage extends NodeMessageBase {
  type: 'message';
  content: string;
  replyTo?: string;
}

// Gateway → Node: AI response
export interface NodeResponseMessage extends NodeMessageBase {
  type: 'response';
  content: string;
  replyTo?: string;
}

// Gateway → Node: Execute command
export interface NodeCommandMessage extends NodeMessageBase {
  type: 'command';
  msgId: string;
  cmd: string;
  args?: string[];
  timeout?: number;    // ms
}

// Node → Gateway: Command result
export interface NodeCommandResultMessage extends NodeMessageBase {
  type: 'command_result';
  msgId: string;       // correlates to command msgId
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// Node → Gateway: Event/sensor data
export interface NodeEventMessage extends NodeMessageBase {
  type: 'event';
  name: string;         // e.g. 'temperature', 'motion', 'button_press'
  data: Record<string, unknown>;
}

// Node → Gateway: System info update
export interface NodeSysInfoMessage extends NodeMessageBase {
  type: 'sysinfo';
  info: NodeSystemInfo;
}

// Node ↔ Node: Relay message
export interface NodeRelayMessage extends NodeMessageBase {
  type: 'relay';
  fromNodeId: string;
  targetNodeId: string;
  payload: Record<string, unknown>;
}

// Gateway → Node: Connected nodes list
export interface NodeListMessage extends NodeMessageBase {
  type: 'node_list';
  nodes: Array<{ nodeId: string; name: string; status: NodeStatus; capabilities: NodeCapability[] }>;
}

// Gateway → Node: Error
export interface NodeErrorMessage extends NodeMessageBase {
  type: 'error';
  code: string;
  message: string;
}

// Union of all message types
export type NodeProtocolMessage =
  | NodeAuthMessage
  | NodeAuthOkMessage
  | NodeAuthErrorMessage
  | NodePingMessage
  | NodePongMessage
  | NodeChatMessage
  | NodeResponseMessage
  | NodeCommandMessage
  | NodeCommandResultMessage
  | NodeEventMessage
  | NodeSysInfoMessage
  | NodeRelayMessage
  | NodeListMessage
  | NodeErrorMessage;
