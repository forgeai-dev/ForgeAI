export interface GatewayConfig {
  host: string;
  port: number;
  wsPort: number;
  secret: string;
  cors: {
    origins: string[];
    credentials: boolean;
  };
  tls?: {
    cert: string;
    key: string;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    require2FA: boolean;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

export interface WSMessage {
  type: WSMessageType;
  id: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type WSMessageType =
  | 'auth.request'
  | 'auth.response'
  | 'session.create'
  | 'session.close'
  | 'session.patch'
  | 'message.inbound'
  | 'message.outbound'
  | 'message.stream'
  | 'tool.request'
  | 'tool.approve'
  | 'tool.result'
  | 'channel.status'
  | 'node.list'
  | 'node.invoke'
  | 'health.ping'
  | 'health.pong'
  | 'error';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  latencyMs?: number;
}
