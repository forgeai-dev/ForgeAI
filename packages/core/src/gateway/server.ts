import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import QRCode from 'qrcode';
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
  createAccessTokenManager,
  createTwoFactorAuth,
  type AccessTokenManager,
  type TwoFactorAuth,
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
  public readonly accessTokenManager: AccessTokenManager;
  public readonly twoFactor: TwoFactorAuth;

  // Pending sessions: access token validated but 2FA not yet verified
  private pendingSessions: Map<string, { createdAt: number; ip: string }> = new Map();

  // Rate limiter for auth endpoints (brute-force protection)
  private authAttempts: Map<string, { count: number; firstAttempt: number }> = new Map();
  private static readonly AUTH_RATE_LIMIT = 5; // max attempts
  private static readonly AUTH_RATE_WINDOW = 60_000; // 1 minute window

  private host: string;
  private port: number;

  constructor(options: GatewayOptions) {
    this.host = options.host ?? DEFAULT_GATEWAY_HOST;
    this.port = options.port ?? DEFAULT_GATEWAY_PORT;

    // Initialize Fastify
    this.app = Fastify({
      logger: false,
      trustProxy: false,
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
    this.accessTokenManager = createAccessTokenManager({
      tokenTTL: 300,          // 5 minutes
      maxActiveTokens: 5,
      maxFailedAttempts: 10,
      lockoutDuration: 900,   // 15 minutes
    });
    this.twoFactor = createTwoFactorAuth('ForgeAI');

    logger.info('Gateway instance created');
  }

  async initialize(): Promise<void> {
    // Register plugins
    await this.app.register(cors, {
      origin: true,
      credentials: true,
    });

    await this.app.register(websocket);
    await this.app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max
    await this.app.register(formbody); // For HTML form POST (2FA forms)

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
    // ─── Authentication Middleware (access token system) ───
    // Public paths that don't require authentication
    const AUTH_EXEMPT_EXACT = new Set([
      '/health', '/info', '/auth/access',
      '/api/auth/generate-access', '/api/auth/verify',
      '/auth/verify-totp', '/auth/setup-2fa',
      '/api/googlechat/webhook',
      '/manifest.json', '/sw.js', '/forge.svg', '/favicon.ico',
    ]);
    const AUTH_EXEMPT_PREFIX = [
      '/api/webhooks/receive/',   // Inbound webhook receiver
      '/assets/',                 // Static dashboard assets (JS/CSS)
    ];

    // Check if auth is enabled (default: enabled when GATEWAY_AUTH=true or on non-localhost)
    const authEnabled = process.env['GATEWAY_AUTH'] !== 'false';

    if (authEnabled) {
      this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const path = request.url.split('?')[0];

        // Skip auth for exempt paths
        if (AUTH_EXEMPT_EXACT.has(path)) return;
        if (AUTH_EXEMPT_PREFIX.some(prefix => path.startsWith(prefix))) return;

        // Check JWT from cookie or Authorization header
        const jwt = this.extractJWT(request);
        if (jwt) {
          try {
            this.auth.verifyAccessToken(jwt);
            return; // Valid session — allow through
          } catch {
            // Invalid/expired token — clear cookie and block
            reply.header('Set-Cookie', 'forgeai_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
          }
        }

        // Not authenticated — block
        if (path.startsWith('/api/')) {
          // API calls get 401 JSON
          reply.status(401).send({ error: 'Authentication required', authUrl: '/auth/access' });
        } else {
          // Page requests get redirected to access page
          reply.redirect('/auth/access');
        }
      });
      logger.info('🔒 Authentication middleware enabled (access token system)');
    } else {
      logger.warn('⚠️ Authentication middleware DISABLED (GATEWAY_AUTH=false)');
    }

    // Paths exempt from rate limiting (health checks, dashboard polling, static assets)
    const RATE_LIMIT_EXEMPT = new Set(['/health', '/info', '/api/providers', '/api/chat/sessions']);
    // Also exempt progress polling and static dashboard assets
    const RATE_LIMIT_PREFIX_EXEMPT = ['/api/chat/progress/', '/api/files/', '/dashboard', '/assets/'];

    // Admin-only routes: vault, backup, config, security management
    const ADMIN_ROUTES = [
      '/api/backup/vault',
      '/api/audit/export',
      '/api/audit/integrity',
      '/api/audit/rotate',
      '/api/security/stats',
      '/api/gdpr/export',
      '/api/gdpr/delete',
    ];
    const ADMIN_PREFIX_ROUTES = [
      '/api/providers/',    // Managing API keys
      '/api/ip-filter/',
      '/api/pairing/',
    ];

    // RBAC enforcement middleware — hard enforcement when auth token is present
    // Anonymous requests (no token) are allowed through for backward compatibility
    // until dashboard authentication is fully integrated.
    // Toggle: set RBAC_ENFORCE=true in Vault/env to block even anonymous requests.
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const path = request.url.split('?')[0];
      const method = request.method;

      // Only enforce on mutation operations (POST/PUT/PATCH/DELETE) to admin routes
      if (method === 'GET') return;

      const isAdminRoute = ADMIN_ROUTES.includes(path) ||
        ADMIN_PREFIX_ROUTES.some(prefix => path.startsWith(prefix));

      if (isAdminRoute) {
        const authHeader = request.headers.authorization;
        let role = 'guest';
        let userId: string | undefined;
        let hasToken = false;

        if (authHeader?.startsWith('Bearer ')) {
          hasToken = true;
          try {
            const payload = this.auth.verifyAccessToken(authHeader.slice(7));
            role = (payload as { role?: string }).role ?? 'user';
            userId = (payload as { sub?: string }).sub;
          } catch {
            // Invalid token — treat as guest with hasToken = true (will be blocked)
          }
        }

        const roleEnum = role === 'admin' ? UserRole.ADMIN : role === 'user' ? UserRole.USER : UserRole.GUEST;
        const allowed = this.rbac.check(roleEnum, 'config', 'write', userId);
        if (!allowed) {
          this.auditLogger.log({
            action: 'security.rbac_denied',
            userId,
            ipAddress: request.ip,
            details: { path, method, role, hasToken },
            success: false,
            riskLevel: 'high',
          });

          // Hard enforcement: block if the request has an auth token (authenticated non-admin)
          // OR if RBAC_ENFORCE is enabled (block everything including anonymous)
          const enforceAll = process.env['RBAC_ENFORCE'] === 'true';
          if (hasToken || enforceAll) {
            reply.status(403).send({ error: 'Access denied', requiredRole: 'admin', path, method });
            return;
          }
          // Anonymous (no token) — allow through (soft enforcement) until dashboard auth is integrated
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

    // ─── Audit Log Rotation ─────────────────────────────
    this.app.post('/api/audit/rotate', async (request: FastifyRequest) => {
      const body = request.body as { retentionDays?: number } | null;
      const retentionDays = body?.retentionDays ?? 90;

      const result = await this.auditLogger.rotate(retentionDays);
      return { ...result, retentionDays };
    });

    this.app.get('/api/audit/rotation', async () => {
      const total = await this.auditLogger.query({ limit: 1 });
      const oldest = total.length > 0 ? total[total.length - 1]?.timestamp : null;
      const count = (await this.auditLogger.getSecurityStats()).total;
      return { totalEntries: count, oldestEntry: oldest, defaultRetentionDays: 90 };
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
    const PENDING_TTL = 5 * 60 * 1000; // 5 min for TOTP entry after token validation

    // Cleanup expired pending sessions periodically
    setInterval(() => {
      const now = Date.now();
      for (const [id, s] of this.pendingSessions) {
        if (now - s.createdAt > PENDING_TTL) this.pendingSessions.delete(id);
      }
    }, 60_000);

    // ─── Access Token Exchange: token → pending session → TOTP form ───
    this.app.get('/auth/access', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { token?: string };

      if (!query.token) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML());
      }

      // Validate the temporary access token
      const result = this.accessTokenManager.validate(query.token, request.ip);
      if (!result.valid) {
        this.auditLogger.log({
          action: 'auth.access_token_failed',
          ipAddress: request.ip,
          details: { reason: result.reason },
          success: false,
          riskLevel: 'high',
        });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML(result.reason));
      }

      // Token valid — create pending session awaiting 2FA
      const { randomBytes } = await import('node:crypto');
      const pendingId = randomBytes(24).toString('base64url');
      this.pendingSessions.set(pendingId, { createdAt: Date.now(), ip: request.ip });

      this.auditLogger.log({
        action: 'auth.access_token_used',
        ipAddress: request.ip,
        details: { pendingId, awaiting2FA: true },
        success: true,
        riskLevel: 'medium',
      });

      logger.info('Access token validated, awaiting 2FA', { ip: request.ip, pendingId });

      // Check if 2FA is set up
      const has2FA = this.vault.isInitialized() && this.vault.listKeys().includes('system:2fa_secret');

      if (!has2FA) {
        // First-time setup: generate secret + QR code (server-side data URI)
        const setup = this.twoFactor.generateSetup('admin');
        (this.pendingSessions.get(pendingId) as any).setupSecret = setup.secret;
        const qrDataUri = await QRCode.toDataURL(setup.otpauthUrl, { width: 250, margin: 2 });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.get2FASetupHTML(pendingId, setup.otpauthUrl, qrDataUri));
      }

      // 2FA already configured — show TOTP + PIN form
      reply.header('Content-Type', 'text/html');
      return reply.send(this.getTOTPFormHTML(pendingId));
    });

    // ─── First-time 2FA Setup: confirm TOTP code + Admin PIN + save secret ───
    this.app.post('/auth/setup-2fa', async (request: FastifyRequest, reply: FastifyReply) => {
      // Rate limit auth attempts (brute-force protection)
      const clientIp = request.socket.remoteAddress || 'unknown';
      if (this.isAuthRateLimited(clientIp)) {
        reply.status(429).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Too many attempts. Please wait 1 minute.'));
      }
      this.recordAuthAttempt(clientIp);

      const body = request.body as { pendingId?: string; code?: string; pin?: string };
      if (!body.pendingId || !body.code) {
        reply.status(400).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Missing pending session or code'));
      }

      const pending = this.pendingSessions.get(body.pendingId) as any;
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
        this.pendingSessions.delete(body.pendingId);
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Session expired. Generate a new access token.'));
      }

      const setupSecret = pending.setupSecret;
      if (!setupSecret) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Invalid setup session'));
      }

      // Verify Admin PIN
      const adminPin = process.env['FORGEAI_ADMIN_PIN'];
      if (adminPin && body.pin?.trim() !== adminPin) {
        this.auditLogger.log({
          action: 'auth.2fa_failed',
          ipAddress: request.ip,
          details: { type: 'setup_bad_pin' },
          success: false,
          riskLevel: 'high',
        });
        const otpauthUrl = `otpauth://totp/ForgeAI:admin?secret=${setupSecret}&issuer=ForgeAI`;
        const qrDataUri = await QRCode.toDataURL(otpauthUrl, { width: 250, margin: 2 });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.get2FASetupHTML(body.pendingId, otpauthUrl, qrDataUri, 'Invalid Admin PIN.'));
      }

      // Verify the TOTP code against the setup secret
      const isValid = this.twoFactor.verify(body.code.trim(), setupSecret);
      if (!isValid) {
        this.auditLogger.log({
          action: 'auth.2fa_failed',
          ipAddress: request.ip,
          details: { type: 'setup_confirmation' },
          success: false,
          riskLevel: 'high',
        });
        const otpauthUrl = `otpauth://totp/ForgeAI:admin?secret=${setupSecret}&issuer=ForgeAI`;
        const qrDataUri = await QRCode.toDataURL(otpauthUrl, { width: 250, margin: 2 });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.get2FASetupHTML(body.pendingId, otpauthUrl, qrDataUri, 'Invalid TOTP code. Try again.'));
      }

      // Save 2FA secret to Vault permanently
      if (this.vault.isInitialized()) {
        this.vault.set('system:2fa_secret', setupSecret);
        logger.info('2FA setup completed — secret saved to Vault');
      }

      this.auditLogger.log({
        action: 'auth.2fa_verified',
        ipAddress: request.ip,
        details: { type: 'first_setup' },
        success: true,
        riskLevel: 'medium',
      });

      // Issue JWT
      this.pendingSessions.delete(body.pendingId);
      return this.issueJWTAndRedirect(reply, request.ip);
    });

    // ─── Verify TOTP code + Admin PIN (subsequent logins) ───
    this.app.post('/auth/verify-totp', async (request: FastifyRequest, reply: FastifyReply) => {
      // Rate limit auth attempts (brute-force protection)
      const clientIp = request.socket.remoteAddress || 'unknown';
      if (this.isAuthRateLimited(clientIp)) {
        reply.status(429).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Too many attempts. Please wait 1 minute.'));
      }
      this.recordAuthAttempt(clientIp);

      const body = request.body as { pendingId?: string; code?: string; pin?: string };
      if (!body.pendingId || !body.code) {
        reply.status(400).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Missing pending session or code'));
      }

      const pending = this.pendingSessions.get(body.pendingId);
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
        this.pendingSessions.delete(body.pendingId);
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Session expired. Generate a new access token.'));
      }

      // Verify Admin PIN
      const adminPin = process.env['FORGEAI_ADMIN_PIN'];
      if (adminPin && body.pin?.trim() !== adminPin) {
        this.auditLogger.log({
          action: 'auth.2fa_failed',
          ipAddress: request.ip,
          details: { type: 'login_bad_pin' },
          success: false,
          riskLevel: 'high',
        });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getTOTPFormHTML(body.pendingId, 'Invalid Admin PIN.'));
      }

      // Get 2FA secret from Vault
      const secret = this.vault.isInitialized() ? this.vault.get('system:2fa_secret') : undefined;
      if (!secret) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('2FA not configured. Contact admin.'));
      }

      const isValid = this.twoFactor.verify(body.code.trim(), secret);
      if (!isValid) {
        this.auditLogger.log({
          action: 'auth.2fa_failed',
          ipAddress: request.ip,
          details: { type: 'login' },
          success: false,
          riskLevel: 'high',
        });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getTOTPFormHTML(body.pendingId, 'Invalid TOTP code. Try again.'));
      }

      this.auditLogger.log({
        action: 'auth.2fa_verified',
        ipAddress: request.ip,
        details: { type: 'login' },
        success: true,
        riskLevel: 'medium',
      });

      // Issue JWT
      this.pendingSessions.delete(body.pendingId);
      return this.issueJWTAndRedirect(reply, request.ip);
    });

    // ─── Generate Access Token (localhost/internal-only OR via Vault secret) ───
    this.app.post('/api/auth/generate-access', async (request: FastifyRequest, reply: FastifyReply) => {
      // SECURITY: Use raw TCP socket IP — immune to X-Forwarded-For spoofing
      const socketIp = request.socket.remoteAddress || '';
      const rawIp = socketIp.replace('::ffff:', '');
      const isLocalhost = rawIp === '127.0.0.1' || socketIp === '::1' || socketIp === 'localhost'
        || rawIp.startsWith('172.') || rawIp.startsWith('10.') || rawIp.startsWith('192.168.');

      // Check for master secret in header (for remote generation via SSH tunnel)
      const masterSecret = request.headers['x-forgeai-secret'] as string | undefined;
      const storedSecret = this.vault.isInitialized() ? this.vault.get('system:master_secret') : undefined;
      const hasValidSecret = masterSecret && storedSecret && masterSecret === storedSecret;

      if (!isLocalhost && !hasValidSecret) {
        this.auditLogger.log({
          action: 'auth.generate_denied',
          ipAddress: socketIp,
          details: { reason: 'Non-localhost request without valid secret' },
          success: false,
          riskLevel: 'high',
        });
        reply.status(403).send({ error: 'Access token generation is only available from localhost' });
        return;
      }

      const { token, expiresAt, expiresInSeconds } = this.accessTokenManager.generate();
      const baseUrl = `http://${this.host === '0.0.0.0' ? request.hostname : this.host}:${this.port}`;
      const accessUrl = `${baseUrl}/auth/access?token=${token}`;

      this.auditLogger.log({
        action: 'auth.access_token_generated',
        ipAddress: socketIp,
        details: { expiresAt: expiresAt.toISOString(), expiresInSeconds },
        success: true,
        riskLevel: 'medium',
      });

      return {
        accessUrl,
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds,
      };
    });

    // ─── Verify JWT ───
    this.app.get('/api/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
      const jwt = this.extractJWT(request);
      if (!jwt) {
        reply.status(401).send({ error: 'Not authenticated' });
        return;
      }

      try {
        const payload = this.auth.verifyAccessToken(jwt);
        return { valid: true, user: payload };
      } catch {
        reply.status(401).send({ error: 'Invalid or expired session' });
        return;
      }
    });

    // ─── Logout (revoke session) ───
    this.app.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
      const jwt = this.extractJWT(request);
      if (jwt) {
        try {
          const payload = this.auth.verifyAccessToken(jwt);
          this.auth.revokeToken(payload.jti);
        } catch { /* token already invalid */ }
      }

      reply.header('Set-Cookie', 'forgeai_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return { success: true };
    });

    // ─── Revoke all tokens (emergency) ───
    this.app.post('/api/auth/revoke-all', async (request: FastifyRequest, reply: FastifyReply) => {
      // SECURITY: Use raw TCP socket IP — immune to X-Forwarded-For spoofing
      const socketIp = request.socket.remoteAddress || '';
      const rIp = socketIp.replace('::ffff:', '');
      const isLocalhost = rIp === '127.0.0.1' || socketIp === '::1' || socketIp === 'localhost'
        || rIp.startsWith('172.') || rIp.startsWith('10.') || rIp.startsWith('192.168.');
      if (!isLocalhost) {
        reply.status(403).send({ error: 'Only available from localhost' });
        return;
      }

      const count = this.accessTokenManager.revokeAll();
      this.auditLogger.log({
        action: 'auth.revoke_all',
        ipAddress: socketIp,
        details: { revokedCount: count },
        riskLevel: 'critical',
      });
      return { success: true, revokedAccessTokens: count };
    });
  }

  /**
   * Issue JWT cookie and redirect to dashboard.
   */
  private issueJWTAndRedirect(reply: FastifyReply, ip: string): void {
    const tokenPair = this.auth.generateTokenPair({
      userId: 'admin',
      username: 'admin',
      role: UserRole.ADMIN,
      sessionId: `access-${Date.now()}`,
    });

    reply.header('Set-Cookie',
      `forgeai_session=${tokenPair.accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
    );

    logger.info('JWT session issued after 2FA', { ip, expiresAt: tokenPair.expiresAt.toISOString() });
    reply.redirect('/dashboard');
  }

  /**
   * TOTP verification form HTML (for subsequent logins).
   */
  private getTOTPFormHTML(pendingId: string, error?: string): string {
    const errorBlock = error
      ? `<div class="error">${this.escapeHtml(error)}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ForgeAI — Two-Factor Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 420px; width: 90%; text-align: center; background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 48px 36px; }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 28px; }
    .error { background: #ff4444; color: white; padding: 10px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
    form { display: flex; flex-direction: column; gap: 16px; }
    input[type="text"] { background: #111; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; color: #fff; font-size: 24px; text-align: center; letter-spacing: 8px; font-family: 'Fira Code', monospace; outline: none; }
    input[type="text"]:focus { border-color: #ff6b35; }
    button { background: #ff6b35; color: #fff; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #e55a2b; }
    .footer { color: #555; font-size: 12px; margin-top: 24px; }
  </style>
</head><body>
  <div class="container">
    <div class="logo">🔐</div>
    <h1>Two-Factor Authentication</h1>
    <p class="subtitle">Enter the 6-digit code from your authenticator app</p>
    ${errorBlock}
    <form method="POST" action="/auth/verify-totp">
      <input type="hidden" name="pendingId" value="${this.escapeHtml(pendingId)}">
      <input type="text" name="code" maxlength="6" pattern="[0-9]{6}" required autofocus placeholder="000000" autocomplete="one-time-code">
      <input type="password" name="pin" required placeholder="Admin PIN" style="background:#111;border:1px solid #333;border-radius:8px;padding:12px 16px;color:#fff;font-size:15px;text-align:center;outline:none;letter-spacing:2px;font-family:inherit;">
      <button type="submit">Verify</button>
    </form>
    <p class="footer">Code refreshes every 30 seconds · Admin PIN required</p>
  </div>
</body></html>`;
  }

  /**
   * 2FA first-time setup HTML (QR code + confirmation).
   */
  private get2FASetupHTML(pendingId: string, otpauthUrl: string, qrCodeUrl: string, error?: string): string {
    const errorBlock = error
      ? `<div class="error">${this.escapeHtml(error)}</div>`
      : '';

    // Extract secret from otpauth URL for manual entry
    const secretMatch = otpauthUrl.match(/secret=([A-Z2-7]+)/i);
    const secret = secretMatch ? secretMatch[1] : '';

    return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ForgeAI — Setup Two-Factor Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 480px; width: 90%; text-align: center; background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 40px 32px; }
    .logo { font-size: 48px; margin-bottom: 12px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; color: #fff; }
    .subtitle { color: #888; font-size: 13px; margin-bottom: 24px; }
    .error { background: #ff4444; color: white; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
    .qr-section { background: #fff; border-radius: 12px; padding: 16px; display: inline-block; margin-bottom: 20px; }
    .qr-section img { display: block; }
    .manual-key { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px; margin-bottom: 20px; }
    .manual-key label { display: block; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .manual-key code { font-family: 'Fira Code', monospace; font-size: 14px; color: #4ade80; letter-spacing: 2px; word-break: break-all; }
    .steps { text-align: left; margin-bottom: 20px; }
    .steps p { color: #999; font-size: 13px; margin-bottom: 6px; line-height: 1.5; }
    .steps strong { color: #ccc; }
    form { display: flex; flex-direction: column; gap: 14px; }
    input[type="text"] { background: #111; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; color: #fff; font-size: 24px; text-align: center; letter-spacing: 8px; font-family: 'Fira Code', monospace; outline: none; }
    input[type="text"]:focus { border-color: #ff6b35; }
    button { background: #ff6b35; color: #fff; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #e55a2b; }
    .footer { color: #555; font-size: 11px; margin-top: 20px; }
    hr { border: none; border-top: 1px solid #2a2a2a; margin: 16px 0; }
  </style>
</head><body>
  <div class="container">
    <div class="logo">🔐</div>
    <h1>Setup Two-Factor Authentication</h1>
    <p class="subtitle">Scan the QR code with Google Authenticator, Authy, or any TOTP app</p>
    ${errorBlock}
    <div class="qr-section">
      <img src="${qrCodeUrl}" alt="QR Code" width="200" height="200">
    </div>
    <div class="manual-key">
      <label>Manual entry key</label>
      <code>${secret}</code>
    </div>
    <div class="steps">
      <p><strong>1.</strong> Open your authenticator app</p>
      <p><strong>2.</strong> Scan the QR code or enter the key manually</p>
      <p><strong>3.</strong> Enter the 6-digit code below to confirm</p>
    </div>
    <hr>
    <form method="POST" action="/auth/setup-2fa">
      <input type="hidden" name="pendingId" value="${this.escapeHtml(pendingId)}">
      <input type="text" name="code" maxlength="6" pattern="[0-9]{6}" required autofocus placeholder="000000" autocomplete="one-time-code">
      <input type="password" name="pin" required placeholder="Admin PIN" style="background:#111;border:1px solid #333;border-radius:8px;padding:12px 16px;color:#fff;font-size:15px;text-align:center;outline:none;letter-spacing:2px;font-family:inherit;">
      <button type="submit">Confirm & Activate 2FA</button>
    </form>
    <p class="footer">Save this key securely — Admin PIN is set via FORGEAI_ADMIN_PIN env var</p>
  </div>
</body></html>`;
  }

  /**
   * HTML-escape a string to prevent XSS in rendered HTML.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Check if an IP has exceeded the auth rate limit.
   */
  private isAuthRateLimited(ip: string): boolean {
    const entry = this.authAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.firstAttempt > Gateway.AUTH_RATE_WINDOW) {
      this.authAttempts.delete(ip);
      return false;
    }
    return entry.count >= Gateway.AUTH_RATE_LIMIT;
  }

  /**
   * Record an auth attempt for rate limiting.
   */
  private recordAuthAttempt(ip: string): void {
    const entry = this.authAttempts.get(ip);
    if (!entry || Date.now() - entry.firstAttempt > Gateway.AUTH_RATE_WINDOW) {
      this.authAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
    } else {
      entry.count++;
    }
  }

  /**
   * Extract JWT from cookie or Authorization header.
   */
  private extractJWT(request: FastifyRequest): string | null {
    let token: string | null = null;

    // Check cookie first
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/forgeai_session=([^;]+)/);
      if (match) token = match[1];
    }

    // Check Authorization header
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    // Validate token format: must be a valid JWT (3 base64url segments)
    if (token && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      return null; // Reject malformed tokens before they reach verifyAccessToken
    }

    return token;
  }

  /**
   * Generate the access page HTML (shown when no token or invalid token).
   */
  private getAccessPageHTML(error?: string): string {
    const errorBlock = error
      ? `<div style="background:#ff4444;color:white;padding:12px 20px;border-radius:8px;margin-bottom:24px;font-size:14px;">⚠️ ${error}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ForgeAI — Access Required</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .container {
      max-width: 520px; width: 90%; text-align: center;
      background: #1a1a1a; border: 1px solid #333; border-radius: 16px;
      padding: 48px 36px;
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    .instruction {
      background: #111; border: 1px solid #2a2a2a; border-radius: 10px;
      padding: 20px; text-align: left; margin-bottom: 24px;
    }
    .instruction h3 { font-size: 13px; color: #ff6b35; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .code-block {
      background: #000; border: 1px solid #333; border-radius: 6px;
      padding: 12px 16px; font-family: 'Fira Code', monospace; font-size: 13px;
      color: #4ade80; word-break: break-all; line-height: 1.6;
      margin-top: 8px;
    }
    .step { color: #999; font-size: 13px; margin-bottom: 8px; line-height: 1.5; }
    .step strong { color: #ccc; }
    .divider { border: none; border-top: 1px solid #2a2a2a; margin: 24px 0; }
    .footer { color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔥</div>
    <h1>ForgeAI</h1>
    <p class="subtitle">Dashboard access requires authentication</p>
    ${errorBlock}
    <div class="instruction">
      <h3>How to access</h3>
      <p class="step"><strong>1.</strong> Connect to your server via SSH</p>
      <p class="step"><strong>2.</strong> Run the following command:</p>
      <div class="code-block">curl -s -X POST http://127.0.0.1:${this.port}/api/auth/generate-access | jq</div>
      <p class="step" style="margin-top:12px;"><strong>3.</strong> Open the <strong>accessUrl</strong> in your browser</p>
      <p class="step"><strong>4.</strong> Your session will be valid for <strong>24 hours</strong></p>
    </div>
    <hr class="divider">
    <p class="footer">Access tokens expire in 5 minutes · Sessions last 24h · IP lockout after 10 failed attempts</p>
  </div>
</body>
</html>`;
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

    // Telegram rate limiting — max 1 message per 60s, batch alerts in between
    const TG_COOLDOWN_MS = 60_000;
    let lastTgSentAt = 0;
    let pendingAlerts: Array<{ severity: string; title: string; timestamp: number }> = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const flushTelegramAlerts = async () => {
      batchTimer = null;
      if (pendingAlerts.length === 0) return;

      try {
        const tg = getTelegramChannel();
        if (!tg?.isConnected()) { pendingAlerts = []; return; }

        const perms = tg.getPermissions();
        const adminId = (perms as { adminUsers?: string[] }).adminUsers?.[0];
        if (!adminId) { pendingAlerts = []; return; }

        const count = pendingAlerts.length;
        const criticalCount = pendingAlerts.filter(a => a.severity === 'critical').length;
        const emoji = criticalCount > 0 ? '🚨' : '⚠️';

        let text: string;
        if (count === 1) {
          const a = pendingAlerts[0];
          text = `${emoji} **${a.title}**\n\n_${new Date(a.timestamp).toLocaleString()}_`;
        } else {
          const summary = pendingAlerts.slice(0, 5).map(a => `• ${a.title}`).join('\n');
          const extra = count > 5 ? `\n_...and ${count - 5} more_` : '';
          text = `${emoji} **${count} Security Alerts** (${criticalCount} critical)\n\n${summary}${extra}`;
        }

        await tg.send({ channelType: 'telegram', recipientId: adminId, content: text });
        lastTgSentAt = Date.now();
        pendingAlerts = [];
      } catch (err) {
        logger.error('Failed to send security alert to Telegram', err);
        pendingAlerts = [];
      }
    };

    // Generic webhook alerts — POST to custom URLs stored in Vault
    const sendWebhookAlerts = async (alert: { id?: string; severity: string; title: string; message: string; timestamp: number | Date }) => {
      const webhookUrl = this.vault.isInitialized()
        ? (this.vault.get('env:SECURITY_WEBHOOK_URL') ?? process.env['SECURITY_WEBHOOK_URL'])
        : process.env['SECURITY_WEBHOOK_URL'];
      if (!webhookUrl) return;

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'forgeai',
            type: 'security.alert',
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            timestamp: alert.timestamp,
            id: alert.id,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        logger.debug('Webhook alert delivery failed', { url: webhookUrl, error: (err as Error).message });
      }
    };

    this.auditLogger.onAlert(async (alert) => {
      // 1. Broadcast to WebSocket clients (instant — cheap)
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

      // 2. Queue Telegram alert (rate-limited: max 1 msg per 60s)
      pendingAlerts.push({ severity: alert.severity, title: alert.title, timestamp: Date.now() });

      const elapsed = Date.now() - lastTgSentAt;
      if (elapsed >= TG_COOLDOWN_MS) {
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        await flushTelegramAlerts();
      } else if (!batchTimer) {
        batchTimer = setTimeout(() => flushTelegramAlerts(), TG_COOLDOWN_MS - elapsed);
      }

      // 3. Send to generic webhook (if configured)
      sendWebhookAlerts(alert).catch(() => {});
    });

    logger.info('Security alert handlers registered (WebSocket + Telegram + Webhook, 60s cooldown)');
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();

    try {
      await this.app.listen({ host: this.host, port: this.port });
      logger.info(`🔥 ${APP_NAME} Gateway running at http://${this.host}:${this.port}`);
      logger.info(`🔌 WebSocket available at ws://${this.host}:${this.port}/ws`);
      logger.info(`🛡️  Security modules: RBAC ✓ | Vault ✓ | RateLimit ✓ | PromptGuard ✓ | AuditLog ✓ | AccessToken ✓`);

      // Generate and print startup access URL
      if (process.env['GATEWAY_AUTH'] !== 'false') {
        const { token, expiresAt } = this.accessTokenManager.generate();
        const displayHost = this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
        const accessUrl = `http://${displayHost}:${this.port}/auth/access?token=${token}`;
        logger.info(`🔑 Dashboard access URL (valid 5 min):`);
        logger.info(`   ${accessUrl}`);
        logger.info(`   Expires at: ${expiresAt.toISOString()}`);
        logger.info(`   Generate new: curl -s -X POST http://127.0.0.1:${this.port}/api/auth/generate-access`);
      }

      // Schedule daily audit log rotation (every 24h, keep 90 days)
      const ROTATION_INTERVAL = 24 * 60 * 60 * 1000;
      setInterval(async () => {
        try {
          const result = await this.auditLogger.rotate(90);
          if (result.deleted > 0) {
            logger.info(`Scheduled audit rotation: ${result.deleted} old entries cleaned`);
          }
        } catch (err) {
          logger.error('Scheduled audit rotation failed', err);
        }
      }, ROTATION_INTERVAL);

      // Run rotation once on startup (deferred 30s to not slow boot)
      setTimeout(() => this.auditLogger.rotate(90).catch(() => {}), 30_000);

      // ─── Integrity check on startup (deferred 10s) ──────────
      setTimeout(async () => {
        try {
          const result = await this.auditLogger.verifyIntegrity(500);
          if (result.valid) {
            logger.info(`✅ Audit integrity OK — ${result.totalChecked} entries verified, hash chain intact`);
          } else {
            logger.error(`🚨 AUDIT INTEGRITY FAILURE — broken at entry ${result.brokenAtId ?? '?'} (index ${result.brokenAtIndex ?? '?'}) in ${result.totalChecked} entries!`);
            this.auditLogger.log({
              action: 'security.integrity_check',
              details: {
                valid: false,
                brokenAtId: result.brokenAtId,
                brokenAtIndex: result.brokenAtIndex,
                totalChecked: result.totalChecked,
                trigger: 'startup_check',
              },
              riskLevel: 'critical',
              success: false,
            });
            // Broadcast alert via WebSocket
            const wsBroadcaster = getWSBroadcaster();
            wsBroadcaster.broadcastAll({
              type: 'security.alert',
              payload: {
                severity: 'critical',
                title: 'Audit Integrity Failure',
                message: `Hash chain broken at entry ${result.brokenAtId ?? '?'} (${result.totalChecked} checked)`,
                timestamp: Date.now(),
              },
            });
          }
        } catch (err) {
          logger.warn('Startup integrity check failed', err as Record<string, unknown>);
        }
      }, 10_000);
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
