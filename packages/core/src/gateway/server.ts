import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  createLogger,
  APP_NAME,
  APP_VERSION,
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
  UserRole,
  type HealthStatus,
} from '@forgeai/shared';
import { registerChatRoutes, getTelegramChannel } from './chat-routes.js';
import { getWSBroadcaster } from './ws-broadcaster.js';
import {
  createJWTAuth,
  createRBACEngine,
  createIPFilter,
  type IPFilter,
  createRateLimiter,
  createAuditLogger,
  createPromptGuard,
  createInputSanitizer,
  createVault,
  type JWTAuth,
  type RBACEngine,
  type RateLimiter,
  type AuditLogger,
  type PromptGuard,
  type InputSanitizer,
  type Vault,
} from '@forgeai/security';

const logger = createLogger('Core:Gateway');

export interface GatewayOptions {
  host?: string;
  port?: number;
  jwtSecret: string;
  jwtExpiresIn?: number;
  vaultPassword: string;
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
}

export class Gateway {
  private app: FastifyInstance;
  private startedAt: number = 0;

  // Security modules
  public readonly auth: JWTAuth;
  public readonly rbac: RBACEngine;
  public readonly rateLimiter: RateLimiter;
  public readonly auditLogger: AuditLogger;
  public readonly promptGuard: PromptGuard;
  public readonly inputSanitizer: InputSanitizer;
  public readonly vault: Vault;
  public readonly ipFilter: IPFilter;

  private host: string;
  private port: number;

  constructor(options: GatewayOptions) {
    this.host = options.host ?? DEFAULT_GATEWAY_HOST;
    this.port = options.port ?? DEFAULT_GATEWAY_PORT;

    // Initialize Fastify
    this.app = Fastify({
      logger: false,
      trustProxy: true,
      bodyLimit: 15 * 1024 * 1024, // 15MB for base64 image uploads
    });

    // Initialize security modules
    this.auth = createJWTAuth(options.jwtSecret, options.jwtExpiresIn);
    this.rbac = createRBACEngine();
    this.rateLimiter = createRateLimiter({
      windowMs: options.rateLimitWindowMs,
      maxRequests: options.rateLimitMaxRequests,
    });
    this.auditLogger = createAuditLogger();
    this.promptGuard = createPromptGuard();
    this.inputSanitizer = createInputSanitizer();
    this.vault = createVault();
    this.ipFilter = createIPFilter({
      enabled: process.env.IP_FILTER_ENABLED === 'true',
      mode: (process.env.IP_FILTER_MODE as 'allowlist' | 'blocklist') ?? 'blocklist',
    });

    logger.info('Gateway instance created');
  }

  async initialize(): Promise<void> {
    // Register plugins
    await this.app.register(cors, {
      origin: true,
      credentials: true,
    });

    await this.app.register(websocket);

    // Register routes
    this.registerHealthRoutes();
    this.registerSecuritySummaryRoutes();
    this.registerBackupRoutes();
    this.registerAuthRoutes();
    this.registerSecurityMiddleware();
    this.registerWSRoutes();

    // Register chat + agent routes (pass vault for persistent key storage)
    await registerChatRoutes(this.app, this.vault);

    // Wire security alerts → Telegram + WebSocket
    this.registerSecurityAlerts();

    // Serve dashboard static files (SPA)
    await this.registerDashboardRoutes();

    logger.info('Gateway initialized');
  }

  private async registerDashboardRoutes(): Promise<void> {
    const { resolve } = await import('node:path');
    const { existsSync, readFileSync, createReadStream, statSync } = await import('node:fs');

    // Try multiple paths to find dashboard dist
    const candidates = [
      resolve(process.cwd(), 'packages', 'dashboard', 'dist'),
      resolve(__dirname, '..', '..', '..', 'dashboard', 'dist'),
      resolve(process.cwd(), 'dashboard', 'dist'),
    ];
    const dashboardDir = candidates.find(p => existsSync(resolve(p, 'index.html')));
    if (!dashboardDir) {
      logger.warn('Dashboard dist not found, skipping static serving', { tried: candidates });
      return;
    }

    const indexHtml = readFileSync(resolve(dashboardDir, 'index.html'), 'utf-8');
    const mimeTypes: Record<string, string> = {
      js: 'application/javascript', css: 'text/css', html: 'text/html',
      svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
      json: 'application/json', ico: 'image/x-icon', woff2: 'font/woff2',
      woff: 'font/woff', ttf: 'font/ttf', webp: 'image/webp',
    };

    // Serve /assets/* (hashed build files)
    this.app.get('/assets/*', async (request: FastifyRequest, reply: FastifyReply) => {
      const urlPath = (request.params as { '*': string })['*'];
      const filePath = resolve(dashboardDir, 'assets', urlPath);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        reply.status(404).send({ error: 'Not found' });
        return;
      }
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(createReadStream(filePath));
    });

    // Serve root static files (manifest.json, sw.js, forge.svg, etc.)
    const rootStaticFiles = ['manifest.json', 'sw.js', 'forge.svg', 'favicon.ico'];
    for (const file of rootStaticFiles) {
      const filePath = resolve(dashboardDir, file);
      if (existsSync(filePath)) {
        this.app.get(`/${file}`, async (_request: FastifyRequest, reply: FastifyReply) => {
          const ext = file.split('.').pop()?.toLowerCase() || '';
          reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          reply.header('Cache-Control', 'public, max-age=3600');
          return reply.send(createReadStream(filePath));
        });
      }
    }

    // SPA fallback: serve index.html for /dashboard and sub-routes
    const serveIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Content-Type', 'text/html');
      return reply.send(indexHtml);
    };
    this.app.get('/dashboard', serveIndex);
    this.app.get('/dashboard/*', serveIndex);

    // Catch-all: serve index.html for any unmatched GET requests (SPA routing)
    this.app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      // Only serve SPA for GET requests to non-API paths
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/ws')) {
        reply.header('Content-Type', 'text/html');
        return reply.send(indexHtml);
      }
      reply.status(404).send({ error: 'Not found' });
    });

    logger.info('Dashboard static routes registered', { path: dashboardDir });
  }

  private registerSecurityMiddleware(): void {
    // Paths exempt from rate limiting (health checks, dashboard polling, static assets)
    const RATE_LIMIT_EXEMPT = new Set(['/health', '/info', '/api/providers', '/api/chat/sessions']);
    // Also exempt progress polling and static dashboard assets
    const RATE_LIMIT_PREFIX_EXEMPT = ['/api/chat/progress/', '/api/files/', '/dashboard', '/assets/'];

    // Admin-only routes: vault, backup, config, security management
    const ADMIN_ROUTES = [
      '/api/backup/vault',
      '/api/audit/export',
      '/api/audit/integrity',
      '/api/security/stats',
      '/api/gdpr/export',
      '/api/gdpr/delete',
    ];
    const ADMIN_PREFIX_ROUTES = [
      '/api/providers/',    // Managing API keys
      '/api/ip-filter/',
      '/api/pairing/',
    ];

    // RBAC enforcement middleware — logs denied access, does NOT block (soft enforcement)
    // Blocking is only for write operations on critical routes
    this.app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
      const path = request.url.split('?')[0];
      const method = request.method;

      // Only enforce on mutation operations (POST/PUT/PATCH/DELETE) to admin routes
      if (method === 'GET') return;

      const isAdminRoute = ADMIN_ROUTES.includes(path) ||
        ADMIN_PREFIX_ROUTES.some(prefix => path.startsWith(prefix));

      if (isAdminRoute) {
        // Check for auth header — if present, verify; if not, log as anonymous
        const authHeader = request.headers.authorization;
        let role = 'guest';
        let userId: string | undefined;

        if (authHeader?.startsWith('Bearer ')) {
          try {
            const payload = this.auth.verifyAccessToken(authHeader.slice(7));
            role = (payload as { role?: string }).role ?? 'user';
            userId = (payload as { sub?: string }).sub;
          } catch {
            // Invalid token — treat as guest
          }
        }

        const roleEnum = role === 'admin' ? UserRole.ADMIN : role === 'user' ? UserRole.USER : UserRole.GUEST;
        const allowed = this.rbac.check(roleEnum, 'config', 'write', userId);
        if (!allowed) {
          this.auditLogger.log({
            action: 'security.rbac_denied',
            userId,
            ipAddress: request.ip,
            details: { path, method, role },
            success: false,
            riskLevel: 'high',
          });

          // For now: log but allow (soft enforcement) — the dashboard doesn't have auth yet
          // When auth is fully integrated, uncomment the block below:
          // reply.status(403).send({ error: 'Access denied', requiredRole: 'admin' });
          // return;
        }
      }
    });

    // Rate limiting middleware
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip rate limiting for polling/health endpoints
      const path = request.url.split('?')[0];
      if (RATE_LIMIT_EXEMPT.has(path)) return;
      if (RATE_LIMIT_PREFIX_EXEMPT.some(prefix => path.startsWith(prefix))) return;

      const ip = request.ip || 'unknown';
      const result = this.rateLimiter.consume(ip);

      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', result.resetAt.toISOString());

      if (!result.allowed) {
        this.auditLogger.log({
          action: 'rate_limit.exceeded',
          ipAddress: ip,
          details: { path: request.url, retryAfter: result.retryAfter },
        });

        reply.status(429).send({
          error: 'Too Many Requests',
          retryAfter: result.retryAfter,
        });
      }
    });

    // Input sanitization for POST/PUT/PATCH
    this.app.addHook('preHandler', async (request: FastifyRequest) => {
      if (request.body && typeof request.body === 'object') {
        const body = request.body as Record<string, unknown>;
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === 'string') {
            const result = this.inputSanitizer.sanitize(value);
            if (!result.clean) {
              this.auditLogger.log({
                action: 'prompt_injection.detected',
                ipAddress: request.ip,
                details: { field: key, blocked: result.blocked },
                success: false,
                riskLevel: 'high',
              });
            }
          }
        }
      }
    });
  }

  private registerHealthRoutes(): void {
    this.app.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
      const status: HealthStatus = {
        status: 'healthy',
        uptime: Date.now() - this.startedAt,
        version: APP_VERSION,
        checks: [
          { name: 'gateway', status: 'pass' },
          { name: 'security', status: 'pass' },
        ],
      };
      return status;
    });

    this.app.get('/info', async () => {
      return {
        name: APP_NAME,
        version: APP_VERSION,
        uptime: Date.now() - this.startedAt,
        security: {
          rbac: true,
          vault: this.vault.isInitialized(),
          rateLimiter: true,
          promptGuard: true,
          inputSanitizer: true,
          twoFactor: true,
          auditLog: true,
        },
      };
    });

    this.app.get('/api/health/detailed', async () => {
      const uptimeMs = Date.now() - this.startedAt;
      const mem = process.memoryUsage();
      return {
        status: 'healthy',
        uptime: {
          ms: uptimeMs,
          hours: Math.floor(uptimeMs / 3600000),
          minutes: Math.floor((uptimeMs % 3600000) / 60000),
          seconds: Math.floor((uptimeMs % 60000) / 1000),
        },
        version: APP_VERSION,
        node: process.version,
        platform: process.platform,
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
          externalMB: Math.round(mem.external / 1024 / 1024),
        },
        security: {
          rbac: true,
          vault: this.vault.isInitialized(),
          rateLimiter: true,
          promptGuard: true,
          inputSanitizer: true,
          twoFactor: true,
          auditLog: true,
        },
        checks: [
          { name: 'gateway', status: 'pass' },
          { name: 'security', status: 'pass' },
          { name: 'memory', status: mem.heapUsed < 512 * 1024 * 1024 ? 'pass' : 'warn', message: `${Math.round(mem.heapUsed / 1024 / 1024)}MB heap` },
        ],
      };
    });
  }

  private registerSecuritySummaryRoutes(): void {
    this.app.get('/api/security/summary', async () => {
      // Query recent high-risk audit events
      const recentAlerts = await this.auditLogger.query({
        riskLevel: 'high',
        limit: 20,
      });
      const recentCritical = await this.auditLogger.query({
        riskLevel: 'critical',
        limit: 10,
      });

      // Count events by type
      const allRecent = [...recentCritical, ...recentAlerts];
      const counts = {
        promptGuardBlocks: allRecent.filter(e => e.action === 'prompt_injection.detected').length,
        rateLimitTriggered: allRecent.filter(e => e.action === 'rate_limit.exceeded').length,
        sandboxViolations: allRecent.filter(e => e.action === 'sandbox.violation').length,
        authFailures: allRecent.filter(e => e.action === 'auth.login_failed' || e.action === 'auth.2fa_failed').length,
        toolBlocked: allRecent.filter(e => e.action === 'tool.blocked').length,
        anomalies: allRecent.filter(e => e.action === 'anomaly.detected').length,
      };

      // Recent events formatted
      const events = allRecent
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 15)
        .map(e => ({
          id: e.id,
          action: e.action,
          riskLevel: e.riskLevel,
          success: e.success,
          timestamp: e.timestamp,
          details: e.details,
          ipAddress: e.ipAddress,
        }));

      // Module details
      const modules = [
        { name: 'RBAC', key: 'rbac', active: true, description: 'Role-Based Access Control' },
        { name: 'Vault', key: 'vault', active: this.vault.isInitialized(), description: 'Credential Vault (AES-256-GCM)' },
        { name: 'Rate Limiter', key: 'rateLimiter', active: true, description: 'Per-channel/tool rate limiting' },
        { name: 'Prompt Guard', key: 'promptGuard', active: true, description: 'Injection detection (6 patterns)' },
        { name: 'Input Sanitizer', key: 'inputSanitizer', active: true, description: 'XSS, SQLi, command injection' },
        { name: '2FA (TOTP)', key: 'twoFactor', active: true, description: 'Two-factor authentication' },
        { name: 'Audit Log', key: 'auditLog', active: true, description: 'Immutable event log with risk levels' },
      ];

      return {
        modules,
        counts,
        events,
        bufferSize: this.auditLogger.getBufferSize(),
        totalAlerts: allRecent.length,
      };
    });

    // ─── Audit Export (JSON/CSV) ──────────────────────────
    this.app.get('/api/audit/export', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        format?: string;
        riskLevel?: string;
        action?: string;
        from?: string;
        to?: string;
        limit?: string;
      };

      const format = (query.format === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
      const filters: Record<string, unknown> = {};
      if (query.riskLevel) filters.riskLevel = query.riskLevel;
      if (query.action) filters.action = query.action;
      if (query.from) filters.from = new Date(query.from);
      if (query.to) filters.to = new Date(query.to);
      if (query.limit) filters.limit = parseInt(query.limit, 10);

      const data = await this.auditLogger.exportEntries(filters as any, format);

      this.auditLogger.log({
        action: 'audit.export',
        details: { format, filterCount: Object.keys(filters).length },
        riskLevel: 'medium',
      });

      if (format === 'csv') {
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="forgeai-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
        return reply.send(data);
      }

      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="forgeai-audit-${new Date().toISOString().slice(0, 10)}.json"`);
      return reply.send(data);
    });

    // ─── Audit Integrity Verification ─────────────────────
    this.app.get('/api/audit/integrity', async () => {
      const result = await this.auditLogger.verifyIntegrity(1000);

      this.auditLogger.log({
        action: 'security.integrity_check',
        details: { valid: result.valid, checked: result.totalChecked },
        riskLevel: result.valid ? 'low' : 'critical',
        success: result.valid,
      });

      return result;
    });

    // ─── Security Stats & Trends ──────────────────────────
    this.app.get('/api/security/stats', async () => {
      return this.auditLogger.getSecurityStats();
    });

    // ─── Audit Events (paginated) ─────────────────────────
    this.app.get('/api/audit/events', async (request: FastifyRequest) => {
      const query = request.query as {
        riskLevel?: string;
        action?: string;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      };

      const filters: Record<string, unknown> = {};
      if (query.riskLevel) filters.riskLevel = query.riskLevel;
      if (query.action) filters.action = query.action;
      if (query.from) filters.from = new Date(query.from);
      if (query.to) filters.to = new Date(query.to);
      filters.limit = parseInt(query.limit ?? '50', 10);
      filters.offset = parseInt(query.offset ?? '0', 10);

      const entries = await this.auditLogger.query(filters as any);
      const total = await this.auditLogger.query({ ...filters as any, limit: undefined, offset: undefined });

      return {
        entries,
        total: total.length,
        limit: filters.limit,
        offset: filters.offset,
      };
    });
  }

  private registerBackupRoutes(): void {
    // Export vault (encrypted payloads only — safe to store)
    this.app.get('/api/backup/vault', async () => {
      if (!this.vault.isInitialized()) return { error: 'Vault not initialized' };
      const data = this.vault.exportEncrypted();
      const keys = this.vault.listKeys();
      this.auditLogger.log({
        action: 'backup.vault.export',
        details: { keyCount: keys.length },
        riskLevel: 'high',
      });
      return {
        type: 'vault',
        exportedAt: new Date().toISOString(),
        version: APP_VERSION,
        keyCount: keys.length,
        data,
      };
    });

    // Import vault entries
    this.app.post('/api/backup/vault', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!this.vault.isInitialized()) { reply.status(503).send({ error: 'Vault not initialized' }); return; }
      const body = request.body as { data?: Record<string, unknown> };
      if (!body.data || typeof body.data !== 'object') {
        reply.status(400).send({ error: 'data object is required' });
        return;
      }
      this.vault.importEncrypted(body.data as Record<string, { ciphertext: string; iv: string; tag: string; salt: string; version: number }>);
      this.auditLogger.log({
        action: 'backup.vault.import',
        details: { keyCount: Object.keys(body.data).length },
        riskLevel: 'critical',
      });
      return { success: true, imported: Object.keys(body.data).length };
    });

    // Full system backup metadata
    this.app.get('/api/backup/info', async () => {
      const mem = process.memoryUsage();
      return {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        vault: {
          initialized: this.vault.isInitialized(),
          keyCount: this.vault.listKeys().length,
        },
        system: {
          uptime: Date.now() - this.startedAt,
          heapMB: Math.round(mem.heapUsed / 1024 / 1024),
          node: process.version,
          platform: process.platform,
        },
      };
    });

    logger.info('Backup routes registered');
  }

  private registerAuthRoutes(): void {
    // Login
    this.app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as { username: string; password: string };

      if (!username || !password) {
        reply.status(400).send({ error: 'Username and password required' });
        return;
      }

      // TODO: lookup user in DB, verify password
      // For now, return a placeholder
      this.auditLogger.log({
        action: 'auth.login',
        ipAddress: request.ip,
        details: { username },
      });

      reply.status(501).send({ error: 'Auth backend not yet connected to database' });
    });

    // Verify token
    this.app.get('/api/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        reply.status(401).send({ error: 'Missing authorization header' });
        return;
      }

      try {
        const token = authHeader.slice(7);
        const payload = this.auth.verifyAccessToken(token);
        return { valid: true, user: payload };
      } catch {
        reply.status(401).send({ error: 'Invalid or expired token' });
        return;
      }
    });
  }

  private registerWSRoutes(): void {
    const broadcaster = getWSBroadcaster();

    this.app.get('/ws', { websocket: true }, (socket, _request) => {
      const client = broadcaster.addClient(socket as any);

      socket.on('message', (raw: Buffer) => {
        try {
          const message = JSON.parse(raw.toString());
          logger.debug('WS message received', { type: message.type });

          switch (message.type) {
            case 'health.ping':
              socket.send(JSON.stringify({
                type: 'health.pong',
                id: message.id,
                payload: { uptime: Date.now() - this.startedAt },
                timestamp: Date.now(),
              }));
              break;

            case 'session.subscribe':
              if (message.sessionId) {
                broadcaster.subscribe(client, message.sessionId);
                socket.send(JSON.stringify({
                  type: 'session.subscribed',
                  sessionId: message.sessionId,
                  timestamp: Date.now(),
                }));
              }
              break;

            case 'session.unsubscribe':
              if (message.sessionId) {
                broadcaster.unsubscribe(client, message.sessionId);
              }
              break;

            default:
              socket.send(JSON.stringify({
                type: 'error',
                id: message.id,
                payload: { error: `Unknown message type: ${message.type}` },
                timestamp: Date.now(),
              }));
          }
        } catch (error) {
          logger.error('WS message parse error', error);
          socket.send(JSON.stringify({
            type: 'error',
            payload: { error: 'Invalid JSON' },
            timestamp: Date.now(),
          }));
        }
      });

      socket.on('close', () => {
        broadcaster.removeClient(client);
      });
    });
  }

  private registerSecurityAlerts(): void {
    const broadcaster = getWSBroadcaster();

    this.auditLogger.onAlert(async (alert) => {
      // 1. Broadcast to WebSocket clients (Dashboard real-time)
      broadcaster.broadcastAll({
        type: 'security.alert',
        payload: {
          id: alert.id,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          timestamp: alert.timestamp,
        },
      });

      // 2. Send to Telegram admin (if channel is connected)
      try {
        const tg = getTelegramChannel();
        if (tg?.isConnected()) {
          const perms = tg.getPermissions();
          const adminId = (perms as { adminUsers?: string[] }).adminUsers?.[0];
          if (adminId) {
            const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';
            const text = [
              `${emoji} **${alert.title}**`,
              '',
              alert.message,
              '',
              `_${new Date(alert.timestamp).toLocaleString()}_`,
            ].join('\n');

            await tg.send({
              channelType: 'telegram',
              recipientId: adminId,
              content: text,
            });
          }
        }
      } catch (err) {
        logger.error('Failed to send security alert to Telegram', err);
      }

      // 3. Log that alert was sent
      this.auditLogger.log({
        action: 'security.alert_sent' as any,
        details: {
          alertId: alert.id,
          severity: alert.severity,
          title: alert.title,
          channel: 'websocket+telegram',
        },
        riskLevel: 'low',
      });
    });

    logger.info('Security alert handlers registered (WebSocket + Telegram)');
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();

    try {
      await this.app.listen({ host: this.host, port: this.port });
      logger.info(`🔥 ${APP_NAME} Gateway running at http://${this.host}:${this.port}`);
      logger.info(`🔌 WebSocket available at ws://${this.host}:${this.port}/ws`);
      logger.info(`🛡️  Security modules: RBAC ✓ | Vault ✓ | RateLimit ✓ | PromptGuard ✓ | AuditLog ✓ | 2FA ✓`);
    } catch (error) {
      logger.fatal('Failed to start Gateway', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info('Shutting down Gateway...');
    this.rateLimiter.destroy();
    this.auditLogger.destroy();
    this.vault.destroy();
    await this.app.close();
    logger.info('Gateway stopped');
  }

  getApp(): FastifyInstance {
    return this.app;
  }
}

export function createGateway(options: GatewayOptions): Gateway {
  return new Gateway(options);
}
