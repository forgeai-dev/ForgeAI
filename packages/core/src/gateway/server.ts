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
import { registerChatRoutes, getTelegramChannel, getAppRegistry } from './chat-routes.js';
import { registerConfigSyncRoutes } from './config-sync.js';
import { getWSBroadcaster } from './ws-broadcaster.js';
import { getCompanionBridge } from './companion-bridge.js';
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
  createEmailOTPService,
  type AccessTokenManager,
  type TwoFactorAuth,
  type EmailOTPService,
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
  public readonly emailOTP: EmailOTPService;
  private readonly sensitiveRateLimiter: RateLimiter;

  // Localhost IPs for external detection
  private static readonly LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

  // Pending sessions: access token validated but 2FA not yet verified
  private pendingSessions: Map<string, { createdAt: number; ip: string; totpVerified?: boolean }> = new Map();

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
    this.sensitiveRateLimiter = createRateLimiter({
      windowMs: 60_000, // 1 minute window
      maxRequests: 5,   // max 5 attempts per minute
      keyPrefix: 'sensitive',
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
    this.emailOTP = createEmailOTPService();

    // Auto-configure SMTP from environment if available
    if (this.emailOTP.configureFromEnv()) {
      logger.info('📧 Email OTP configured — external logins will require email verification');
    }

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
    registerConfigSyncRoutes(this.app, this.vault);
    this.registerAuthRoutes();
    this.registerSMTPRoutes();
    this.registerSetupWizardRoutes();
    this.registerSecurityMiddleware();
    this.registerWSRoutes();

    // Load SMTP config from Vault (overrides env vars if available)
    this.loadSMTPFromVault();

    // Register chat + agent routes (pass vault for persistent key storage)
    await registerChatRoutes(this.app, this.vault, this.auth);

    // ─── Subdomain Routing Middleware ─────────────────
    // If a domain is configured with subdomains enabled, routes like
    //   painel.forge.domain.com → serves site "painel" from workspace
    //   meuapp.forge.domain.com → proxies to registered app port
    this.registerSubdomainRouting();

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
      '/auth/verify-totp', '/auth/setup-2fa', '/auth/verify-email', '/auth/change-pin',
      '/setup', '/api/setup/smtp', '/api/setup/init-2fa', '/api/setup/complete',
      '/api/googlechat/webhook',
      '/api/companion/pair',
      '/api/config/sync-receive',  // Has own auth: sync code + AES-256-GCM encryption
      '/ws',                       // WebSocket — auth via token query param, not cookie
      '/manifest.json', '/sw.js', '/forge.svg', '/favicon.ico',
    ]);
    const AUTH_EXEMPT_PREFIX = [
      '/api/webhooks/receive/',   // Inbound webhook receiver
      '/assets/',                 // Static dashboard assets (JS/CSS)
      '/sites/',                  // Published static sites (workspace)
      '/apps/',                   // Dynamic app proxy (agent-started servers)
    ];

    // ─── Smart Security: localhost vs external detection ───
    // GATEWAY_AUTH=false  → auth disabled entirely (dev only)
    // GATEWAY_AUTH=true   → auth always enforced (production)
    // GATEWAY_AUTH unset  → smart: skip auth ONLY for true localhost, enforce for everything else
    //
    // Security guarantees:
    // 1. remoteAddress comes from the OS TCP socket — cannot be spoofed over network
    // 2. If proxy headers (X-Forwarded-For, X-Real-IP) are present, treat as EXTERNAL
    //    even if socket says 127.0.0.1 (reverse proxy scenario)
    // 3. Smart mode only activates when binding to 127.0.0.1 (not 0.0.0.0)
    //    because 0.0.0.0 accepts connections from any interface
    // 4. trustProxy is OFF — Fastify uses raw socket IP, not headers
    const authSetting = process.env['GATEWAY_AUTH'];

    // Only enable smart bypass when binding to loopback interface specifically
    // 0.0.0.0 binds ALL interfaces (including external NICs) — NOT safe for open bypass
    const isStrictlyLocalBinding = Gateway.LOCALHOST_IPS.has(this.host);

    const isTrueLocalRequest = (request: FastifyRequest): boolean => {
      const socketIp = request.socket.remoteAddress || '';

      // Check 1: socket-level IP must be loopback
      if (!Gateway.LOCALHOST_IPS.has(socketIp)) return false;

      // Check 2: if proxy headers exist, someone is proxying — treat as external
      // A real local browser request (curl, Chrome on same machine) never sends these
      const forwarded = request.headers['x-forwarded-for']
        || request.headers['x-real-ip']
        || request.headers['forwarded'];
      if (forwarded) return false;

      return true;
    };

    if (authSetting === 'false') {
      logger.warn('⚠️ Authentication middleware DISABLED (GATEWAY_AUTH=false)');
    } else {
      const authMode = authSetting === 'true' ? 'always' : 'smart';
      this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const path = request.url.split('?')[0];

        // First-run: redirect EVERYTHING to setup wizard (except setup routes + static assets)
        if (this.isFirstRun() && !path.startsWith('/setup') && !path.startsWith('/api/setup')
            && !path.startsWith('/assets/') && !path.endsWith('.svg') && !path.endsWith('.ico')
            && path !== '/health' && path !== '/info' && path !== '/manifest.json' && path !== '/sw.js') {
          if (path.startsWith('/api/')) {
            reply.status(503).send({ error: 'Initial setup required', setupUrl: '/setup' });
          } else {
            reply.redirect('/setup');
          }
          return;
        }

        // Skip auth for exempt paths
        if (AUTH_EXEMPT_EXACT.has(path)) return;
        if (AUTH_EXEMPT_PREFIX.some(prefix => path.startsWith(prefix))) return;

        // Smart mode: skip auth ONLY for true localhost connections
        // Both conditions must be true: server bound to loopback AND request from loopback
        if (authMode === 'smart' && isStrictlyLocalBinding && isTrueLocalRequest(request)) {
          return; // Verified localhost — no auth needed
        }

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
          reply.status(401).send({ error: 'Authentication required', authUrl: '/auth/access' });
        } else {
          reply.redirect('/auth/access');
        }
      });

      if (authMode === 'smart') {
        logger.info(`🔒 Smart auth: localhost=open (binding ${this.host}), external=strict`);
        if (!isStrictlyLocalBinding) {
          logger.warn(`⚠️ Smart auth: binding to ${this.host} (not loopback) — auth enforced for ALL requests. Set GATEWAY_AUTH=false to disable or bind to 127.0.0.1.`);
        }
      } else {
        logger.info('🔒 Authentication middleware enabled (GATEWAY_AUTH=true, always enforce)');
      }
    }

    // Paths exempt from rate limiting (health checks, dashboard polling, static assets)
    const RATE_LIMIT_EXEMPT = new Set(['/health', '/info', '/api/providers', '/api/chat/sessions']);
    // Also exempt progress polling and static dashboard assets
    const RATE_LIMIT_PREFIX_EXEMPT = ['/api/chat/progress/', '/api/files/', '/sites/', '/apps/', '/dashboard', '/assets/'];

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

      // Verify Admin PIN (Vault custom PIN > env var fallback)
      const adminPin = this.getAdminPin();
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

      // ─── External access: require email OTP as additional factor ───
      if (this.shouldRequireEmailOTP(request)) {
        const adminEmail = this.getAdminEmail()!;
        pending.totpVerified = true;

        const sent = await this.emailOTP.sendOTP(body.pendingId, adminEmail);
        if (!sent) {
          reply.header('Content-Type', 'text/html');
          return reply.send(this.getAccessPageHTML('Failed to send email verification. Check SMTP config.'));
        }

        reply.header('Content-Type', 'text/html');
        return reply.send(this.getEmailOTPFormHTML(body.pendingId));
      }

      // ─── Local access or no email config: check if PIN change needed ───
      if (this.isPinDefault()) {
        pending.totpVerified = true;
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId));
      }

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

      // Verify Admin PIN (Vault custom PIN > env var fallback)
      const adminPin = this.getAdminPin();
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

      // ─── External access: require email OTP as additional factor ───
      if (this.shouldRequireEmailOTP(request)) {
        const adminEmail = this.getAdminEmail()!;
        const pending = this.pendingSessions.get(body.pendingId)!;
        pending.totpVerified = true;

        const sent = await this.emailOTP.sendOTP(body.pendingId, adminEmail);
        if (!sent) {
          reply.header('Content-Type', 'text/html');
          return reply.send(this.getTOTPFormHTML(body.pendingId, 'Failed to send email verification. Check SMTP config.'));
        }

        logger.info('Email OTP sent for external login', { ip: request.ip, email: this.emailOTP['maskEmail'] ? '***' : adminEmail });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getEmailOTPFormHTML(body.pendingId));
      }

      // ─── Local access or no email config: check if PIN change needed, then issue JWT ───
      if (this.isPinDefault()) {
        const pending = this.pendingSessions.get(body.pendingId)!;
        pending.totpVerified = true;
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId));
      }

      this.pendingSessions.delete(body.pendingId);
      return this.issueJWTAndRedirect(reply, request.ip);
    });

    // ─── Verify Email OTP (external access 4th factor) ───
    this.app.post('/auth/verify-email', async (request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = request.socket.remoteAddress || 'unknown';

      // Rate limit: sensitive operations limiter (5 req/min per IP)
      const rlResult = this.sensitiveRateLimiter.consume(`email-verify:${clientIp}`);
      if (!rlResult.allowed) {
        reply.status(429).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Too many attempts. Please wait 1 minute.'));
      }

      if (this.isAuthRateLimited(clientIp)) {
        reply.status(429).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Too many attempts. Please wait 1 minute.'));
      }
      this.recordAuthAttempt(clientIp);

      const body = request.body as { pendingId?: string; emailCode?: string };
      if (!body.pendingId || !body.emailCode) {
        reply.status(400).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Missing session or email code'));
      }

      const pending = this.pendingSessions.get(body.pendingId);
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
        this.pendingSessions.delete(body.pendingId);
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Session expired. Generate a new access token.'));
      }

      // Ensure TOTP was already verified for this session
      if (!pending.totpVerified) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Invalid session state. Please start over.'));
      }

      // Verify email OTP
      const result = this.emailOTP.verify(body.pendingId, body.emailCode.trim());
      if (!result.valid) {
        this.auditLogger.log({
          action: 'auth.email_otp_failed',
          ipAddress: request.ip,
          details: { reason: result.reason },
          success: false,
          riskLevel: 'high',
        });
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getEmailOTPFormHTML(body.pendingId, result.reason));
      }

      this.auditLogger.log({
        action: 'auth.email_otp_verified',
        ipAddress: request.ip,
        details: { type: 'external_login' },
        success: true,
        riskLevel: 'medium',
      });

      // Check if PIN change is needed before issuing JWT
      if (this.isPinDefault()) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId));
      }

      this.pendingSessions.delete(body.pendingId);
      return this.issueJWTAndRedirect(reply, request.ip);
    });

    // ─── Force PIN Change (first login with default PIN) ───
    this.app.post('/auth/change-pin', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { pendingId?: string; newPin?: string; confirmPin?: string };
      if (!body.pendingId || !body.newPin || !body.confirmPin) {
        reply.status(400).header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Missing required fields'));
      }

      const pending = this.pendingSessions.get(body.pendingId);
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
        this.pendingSessions.delete(body.pendingId);
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Session expired. Generate a new access token.'));
      }

      if (!pending.totpVerified) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getAccessPageHTML('Invalid session state. Please start over.'));
      }

      // Validate new PIN
      const newPin = body.newPin.trim();
      const confirmPin = body.confirmPin.trim();

      if (newPin.length < 6) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId, 'PIN must be at least 6 characters.'));
      }

      if (newPin !== confirmPin) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId, 'PINs do not match.'));
      }

      // Don't allow keeping the same default PIN
      const defaultPin = process.env['FORGEAI_ADMIN_PIN'];
      if (defaultPin && newPin === defaultPin) {
        reply.header('Content-Type', 'text/html');
        return reply.send(this.getPinChangeHTML(body.pendingId, 'New PIN cannot be the same as the default PIN.'));
      }

      // Store new PIN in Vault (encrypted)
      if (this.vault.isInitialized()) {
        this.vault.set('system:admin_pin', newPin);
        logger.info('Admin PIN changed and stored in Vault');

        this.auditLogger.log({
          action: 'auth.pin_changed',
          ipAddress: request.ip,
          details: { type: 'first_login_force_change' },
          success: true,
          riskLevel: 'medium',
        });
      }

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
      const publicUrl = process.env['PUBLIC_URL'];
      const baseUrl = publicUrl
        ? publicUrl.replace(/\/$/, '')
        : `http://${this.host === '0.0.0.0' ? request.hostname : this.host}:${this.port}`;
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
        accessPath: `/auth/access?token=${token}`,
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds,
        hint: publicUrl ? undefined : 'If accessing remotely, replace 127.0.0.1 with your server public IP.',
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
    reply.redirect('/');
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
   * Email OTP verification form HTML (for external access).
   */
  private getEmailOTPFormHTML(pendingId: string, error?: string): string {
    const errorBlock = error
      ? `<div class="error">${this.escapeHtml(error)}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ForgeAI — Email Verification</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 420px; width: 90%; text-align: center; background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 48px 36px; }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 28px; line-height: 1.5; }
    .error { background: #ff4444; color: white; padding: 10px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
    .info { background: #1a3a2a; border: 1px solid #2a5a3a; color: #4ade80; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
    form { display: flex; flex-direction: column; gap: 16px; }
    input[type="text"] { background: #111; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; color: #fff; font-size: 24px; text-align: center; letter-spacing: 8px; font-family: 'Fira Code', monospace; outline: none; }
    input[type="text"]:focus { border-color: #4ade80; }
    button { background: #4ade80; color: #000; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #22c55e; }
    .footer { color: #555; font-size: 12px; margin-top: 24px; }
    .badge { display: inline-block; background: #ff6b35; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  </style>
</head><body>
  <div class="container">
    <div class="logo">📧</div>
    <span class="badge">External Access</span>
    <h1>Email Verification</h1>
    <p class="subtitle">A 6-digit verification code has been sent to your admin email</p>
    ${errorBlock}
    <div class="info">✅ TOTP + PIN verified · Email code required for external access</div>
    <form method="POST" action="/auth/verify-email">
      <input type="hidden" name="pendingId" value="${this.escapeHtml(pendingId)}">
      <input type="text" name="emailCode" maxlength="6" pattern="[0-9]{6}" required autofocus placeholder="000000" autocomplete="one-time-code">
      <button type="submit">Verify Email Code</button>
    </form>
    <p class="footer">Code expires in 5 minutes · Check your inbox and spam folder</p>
  </div>
</body></html>`;
  }

  /**
   * PIN change form HTML (forced on first login with default PIN).
   */
  private getPinChangeHTML(pendingId: string, error?: string): string {
    const errorBlock = error
      ? `<div class="error">${this.escapeHtml(error)}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ForgeAI — Change Admin PIN</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 420px; width: 90%; text-align: center; background: #1a1a1a; border: 1px solid #333; border-radius: 16px; padding: 48px 36px; }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 28px; line-height: 1.5; }
    .error { background: #ff4444; color: white; padding: 10px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
    .warning { background: #3a2a1a; border: 1px solid #5a3a1a; color: #fbbf24; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; line-height: 1.5; }
    form { display: flex; flex-direction: column; gap: 14px; }
    input[type="password"] { background: #111; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; color: #fff; font-size: 16px; text-align: center; letter-spacing: 2px; font-family: inherit; outline: none; }
    input[type="password"]:focus { border-color: #fbbf24; }
    button { background: #fbbf24; color: #000; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #f59e0b; }
    .footer { color: #555; font-size: 12px; margin-top: 24px; }
  </style>
</head><body>
  <div class="container">
    <div class="logo">🔑</div>
    <h1>Change Admin PIN</h1>
    <p class="subtitle">Your admin PIN is still the default. You must change it before continuing.</p>
    ${errorBlock}
    <div class="warning">⚠️ Using a default PIN is a security risk. Choose a strong, unique PIN that you'll remember.</div>
    <form method="POST" action="/auth/change-pin">
      <input type="hidden" name="pendingId" value="${this.escapeHtml(pendingId)}">
      <input type="password" name="newPin" required placeholder="New PIN (min 6 characters)" minlength="6">
      <input type="password" name="confirmPin" required placeholder="Confirm new PIN" minlength="6">
      <button type="submit">Set New PIN & Continue</button>
    </form>
    <p class="footer">PIN is encrypted and stored in the Vault · Min 6 characters</p>
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
   * First-run setup wizard HTML — multi-step guided setup.
   */
  private getSetupWizardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ForgeAI — Initial Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wizard{background:#111;border:1px solid #222;border-radius:20px;padding:40px;width:520px;max-width:95vw}
.logo{font-size:48px;text-align:center;margin-bottom:8px}
h1{text-align:center;font-size:22px;color:#fff;margin-bottom:4px}
.subtitle{text-align:center;font-size:13px;color:#888;margin-bottom:28px}
.steps-indicator{display:flex;justify-content:center;gap:8px;margin-bottom:28px}
.step-dot{width:10px;height:10px;border-radius:50%;background:#333;transition:all .3s}
.step-dot.active{background:#ff6b35;box-shadow:0 0 8px rgba(255,107,53,.4)}
.step-dot.done{background:#22c55e}
.step{display:none}
.step.active{display:block}
.step h2{font-size:17px;color:#fff;margin-bottom:6px}
.step p.desc{font-size:12px;color:#888;margin-bottom:18px;line-height:1.5}
label{display:block;font-size:12px;color:#999;margin-bottom:4px;margin-top:12px}
input[type=text],input[type=email],input[type=password],input[type=number]{width:100%;background:#0a0a0a;border:1px solid #333;border-radius:8px;padding:10px 14px;color:#fff;font-size:14px;outline:none;transition:border .2s}
input:focus{border-color:#ff6b35}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s}
.btn-primary{background:#ff6b35;color:#fff}.btn-primary:hover{background:#e55a28}
.btn-primary:disabled{background:#555;cursor:not-allowed}
.btn-secondary{background:transparent;color:#999;border:1px solid #333}.btn-secondary:hover{border-color:#555;color:#fff}
.btn-test{background:transparent;border:1px solid #ff6b35;color:#ff6b35;font-size:12px;padding:8px 14px}.btn-test:hover{background:#ff6b35;color:#fff}
.actions{display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:18px;border-top:1px solid #222}
.msg{font-size:12px;padding:8px 12px;border-radius:8px;margin-top:12px;display:none}
.msg.error{display:block;background:#2d1515;border:1px solid #5c2020;color:#f87171}
.msg.success{display:block;background:#0f2918;border:1px solid #1a5c30;color:#4ade80}
.msg.info{display:block;background:#1a1a2e;border:1px solid #2a2a5e;color:#818cf8}
.qr-section{text-align:center;margin:16px 0}
.qr-section img{border-radius:12px;background:#fff;padding:8px}
.manual-key{text-align:center;margin:8px 0}
.manual-key code{background:#1a1a1a;padding:6px 14px;border-radius:6px;font-size:13px;color:#ff6b35;letter-spacing:1px;user-select:all}
.skip-link{font-size:11px;color:#666;cursor:pointer;text-decoration:underline}.skip-link:hover{color:#999}
.feature-list{list-style:none;margin:12px 0}
.feature-list li{padding:6px 0;font-size:13px;color:#ccc;display:flex;align-items:center;gap:8px}
.feature-list li::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff6b35;flex-shrink:0}
.loading{display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#ff6b35;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.complete-icon{font-size:64px;text-align:center;margin:20px 0}
</style>
</head><body>
<div class="wizard">
  <div class="logo">&#x1F525;</div>
  <h1>ForgeAI Setup</h1>
  <p class="subtitle">Let's secure your instance in a few steps</p>
  <div class="steps-indicator">
    <div class="step-dot active" id="dot-0"></div>
    <div class="step-dot" id="dot-1"></div>
    <div class="step-dot" id="dot-2"></div>
    <div class="step-dot" id="dot-3"></div>
  </div>

  <!-- Step 0: Welcome -->
  <div class="step active" id="step-0">
    <h2>Welcome to ForgeAI</h2>
    <p class="desc">This wizard will configure your security settings. You'll set up:</p>
    <ul class="feature-list">
      <li>Email OTP — verification codes sent to your email for external access</li>
      <li>Two-Factor Authentication — TOTP app (Google Authenticator, Authy)</li>
      <li>Custom Admin PIN — replace the default PIN with your own secure PIN</li>
    </ul>
    <p class="desc" style="margin-top:16px;color:#ff6b35">After setup, accessing from the internet requires: Access Token + TOTP + PIN + Email OTP (4-factor auth).</p>
    <div class="actions">
      <div></div>
      <button class="btn btn-primary" onclick="goStep(1)">Get Started &rarr;</button>
    </div>
  </div>

  <!-- Step 1: SMTP Configuration -->
  <div class="step" id="step-1">
    <h2>Email Configuration (SMTP)</h2>
    <p class="desc">Configure your email to receive security verification codes when accessing ForgeAI remotely.</p>
    <div class="row">
      <div><label>SMTP Host</label><input type="text" id="smtp-host" placeholder="smtp.gmail.com" value="smtp.gmail.com"></div>
      <div><label>Port</label><input type="number" id="smtp-port" placeholder="587" value="587"></div>
    </div>
    <label>Email (SMTP username)</label>
    <input type="email" id="smtp-user" placeholder="your-email@gmail.com">
    <label>Password (App Password for Gmail)</label>
    <input type="password" id="smtp-pass" placeholder="16-character app password">
    <label>From (display name)</label>
    <input type="text" id="smtp-from" placeholder="ForgeAI <your-email@gmail.com>">
    <label>Admin Email (receives OTP codes)</label>
    <input type="email" id="smtp-admin" placeholder="your-email@gmail.com">
    <div id="smtp-msg" class="msg"></div>
    <div style="margin-top:10px">
      <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" style="font-size:11px;color:#ff6b35">Gmail users: Get an App Password here &rarr;</a>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="goStep(0)">&larr; Back</button>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="skip-link" onclick="goStep(2)">Skip (configure later)</span>
        <button class="btn btn-primary" id="smtp-save-btn" onclick="saveSMTP()">Save & Test</button>
      </div>
    </div>
  </div>

  <!-- Step 2: 2FA Setup -->
  <div class="step" id="step-2">
    <h2>Two-Factor Authentication</h2>
    <p class="desc">Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.)</p>
    <div class="qr-section" id="qr-container">
      <div class="loading" style="width:24px;height:24px"></div>
      <p style="font-size:12px;color:#666;margin-top:8px">Generating QR code...</p>
    </div>
    <div class="manual-key" id="manual-key-container" style="display:none">
      <label style="margin:0">Manual entry key</label>
      <code id="manual-key"></code>
    </div>
    <div id="tfa-msg" class="msg"></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="goStep(1)">&larr; Back</button>
      <button class="btn btn-primary" onclick="goStep(3)">Next &rarr;</button>
    </div>
  </div>

  <!-- Step 3: Verify TOTP + Set PIN -->
  <div class="step" id="step-3">
    <h2>Verify & Set Your PIN</h2>
    <p class="desc">Enter the 6-digit code from your authenticator app and choose a custom admin PIN.</p>
    <label>TOTP Code (from authenticator app)</label>
    <input type="text" id="totp-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" autocomplete="one-time-code" style="text-align:center;font-size:20px;letter-spacing:6px">
    <label>New Admin PIN (min 6 characters)</label>
    <input type="password" id="new-pin" placeholder="Choose a secure PIN" style="letter-spacing:2px">
    <label>Confirm PIN</label>
    <input type="password" id="confirm-pin" placeholder="Repeat your PIN" style="letter-spacing:2px">
    <div id="complete-msg" class="msg"></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="goStep(2)">&larr; Back</button>
      <button class="btn btn-primary" id="complete-btn" onclick="completeSetup()">Complete Setup</button>
    </div>
  </div>

  <!-- Step 4: Done -->
  <div class="step" id="step-4">
    <div class="complete-icon">&#x2705;</div>
    <h2 style="text-align:center">Setup Complete!</h2>
    <p class="desc" style="text-align:center">Your ForgeAI instance is now secured. Redirecting to dashboard...</p>
    <div class="msg success" style="display:block;text-align:center">
      4-Factor authentication is now active for external access.
    </div>
  </div>
</div>

<script>
let currentStep = 0;
let tfaInitialized = false;

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  document.getElementById('step-' + n).classList.add('active');
  // Update dots
  for (let i = 0; i <= 3; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }
  currentStep = n;
  // Init 2FA when entering step 2
  if (n === 2 && !tfaInitialized) init2FA();
}

async function saveSMTP() {
  const btn = document.getElementById('smtp-save-btn');
  const msg = document.getElementById('smtp-msg');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Testing...';
  msg.className = 'msg';
  msg.style.display = 'none';

  try {
    const res = await fetch('/api/setup/smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: document.getElementById('smtp-host').value,
        port: Number(document.getElementById('smtp-port').value) || 587,
        user: document.getElementById('smtp-user').value,
        pass: document.getElementById('smtp-pass').value,
        from: document.getElementById('smtp-from').value,
        adminEmail: document.getElementById('smtp-admin').value,
      }),
    });
    const data = await res.json();
    if (data.error) {
      msg.className = 'msg error'; msg.textContent = data.error; msg.style.display = 'block';
    } else {
      msg.className = 'msg success'; msg.textContent = data.message || 'SMTP saved!'; msg.style.display = 'block';
      setTimeout(() => goStep(2), 1200);
    }
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = 'Request failed: ' + e.message; msg.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Save & Test';
}

async function init2FA() {
  const container = document.getElementById('qr-container');
  const keyContainer = document.getElementById('manual-key-container');
  const msg = document.getElementById('tfa-msg');
  try {
    const res = await fetch('/api/setup/init-2fa', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      msg.className = 'msg error'; msg.textContent = data.error; msg.style.display = 'block';
      return;
    }
    container.innerHTML = '<img src="' + data.qrCode + '" alt="QR Code" width="200" height="200">';
    document.getElementById('manual-key').textContent = data.secret;
    keyContainer.style.display = 'block';
    tfaInitialized = true;
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = 'Failed to generate QR: ' + e.message; msg.style.display = 'block';
  }
}

async function completeSetup() {
  const btn = document.getElementById('complete-btn');
  const msg = document.getElementById('complete-msg');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> Verifying...';
  msg.className = 'msg'; msg.style.display = 'none';

  try {
    const res = await fetch('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: document.getElementById('totp-code').value.trim(),
        newPin: document.getElementById('new-pin').value,
        confirmPin: document.getElementById('confirm-pin').value,
      }),
    });
    const data = await res.json();
    if (data.error) {
      msg.className = 'msg error'; msg.textContent = data.error; msg.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Complete Setup';
      return;
    }
    // Success — show step 4 and redirect
    document.getElementById('step-3').classList.remove('active');
    document.getElementById('step-4').classList.add('active');
    for (let i = 0; i <= 3; i++) {
      document.getElementById('dot-' + i).classList.remove('active');
      document.getElementById('dot-' + i).classList.add('done');
    }
    setTimeout(() => { window.location.href = '/'; }, 2000);
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = 'Request failed: ' + e.message; msg.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Complete Setup';
  }
}

// Auto-fill admin email into "from" when user types email
document.getElementById('smtp-user').addEventListener('input', function() {
  const from = document.getElementById('smtp-from');
  const admin = document.getElementById('smtp-admin');
  if (!from.value || from.value.includes('{')) from.value = 'ForgeAI <' + this.value + '>';
  if (!admin.value) admin.value = this.value;
});
</script>
</body></html>`;
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
   * Check if a request comes from an external (non-localhost) IP.
   * Used to enforce email OTP for external access.
   */
  private isExternalRequest(request: FastifyRequest): boolean {
    const socketIp = request.socket.remoteAddress || '';
    if (!Gateway.LOCALHOST_IPS.has(socketIp)) return true;
    // Docker internal IPs (172.x, 10.x) are treated as local (container-to-container)
    const rawIp = socketIp.replace('::ffff:', '');
    if (rawIp.startsWith('172.') || rawIp.startsWith('10.') || rawIp.startsWith('192.168.')) return false;
    // Proxy headers mean external origin
    const forwarded = request.headers['x-forwarded-for']
      || request.headers['x-real-ip']
      || request.headers['forwarded'];
    if (forwarded) return true;
    return false;
  }

  /**
   * Get admin PIN — checks Vault (custom PIN) first, then env var fallback.
   */
  private getAdminPin(): string | null {
    // Custom PIN stored in Vault takes priority (set during force-change)
    if (this.vault.isInitialized()) {
      const customPin = this.vault.get('system:admin_pin');
      if (customPin) return customPin;
    }
    // Fallback to env var (default/initial PIN)
    return process.env['FORGEAI_ADMIN_PIN'] || null;
  }

  /**
   * Check if the admin PIN is still the default (env var) and needs to be changed.
   */
  private isPinDefault(): boolean {
    if (!this.vault.isInitialized()) return false;
    const customPin = this.vault.get('system:admin_pin');
    return !customPin && !!process.env['FORGEAI_ADMIN_PIN'];
  }

  /**
   * Check if this is the first run (no 2FA configured yet).
   * Used to show the setup wizard instead of requiring auth.
   */
  private isFirstRun(): boolean {
    if (!this.vault.isInitialized()) return true;
    return !this.vault.listKeys().includes('system:2fa_secret');
  }

  /**
   * Determine if email OTP should be required for this request.
   * Required when: external request + SMTP configured + admin email set.
   */
  private shouldRequireEmailOTP(request: FastifyRequest): boolean {
    if (!this.emailOTP.isConfigured()) return false;
    const adminEmail = this.getAdminEmail();
    if (!adminEmail) return false;
    return this.isExternalRequest(request);
  }

  /**
   * Get admin email from Vault or env var.
   */
  private getAdminEmail(): string | null {
    if (this.vault.isInitialized()) {
      const email = this.vault.get('system:admin_email');
      if (email) return email;
    }
    return process.env['ADMIN_EMAIL'] || null;
  }

  /**
   * Subdomain routing: intercepts requests where Host = <name>.<domain>
   * and serves the corresponding site from workspace or proxies to an app port.
   */
  private registerSubdomainRouting(): void {
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      // Only active if domain + subdomains are configured in Vault
      if (!this.vault.isInitialized()) return;
      const domain = this.vault.get('config:domain');
      const subdomainsEnabled = this.vault.get('config:subdomains_enabled') === 'true';
      if (!domain || !subdomainsEnabled) return;

      // Extract hostname (strip port if present)
      const host = (request.headers.host || '').split(':')[0].toLowerCase();
      if (!host || host === domain || !host.endsWith(`.${domain}`)) return;

      // Extract subdomain: e.g., "painel.forge.domain.com" → "painel"
      const subdomain = host.slice(0, host.length - domain.length - 1);
      if (!subdomain || subdomain.includes('.')) return; // Skip nested subdomains

      // Skip API/WS/health paths — they should always go to the gateway
      const path = request.url.split('?')[0];
      if (path.startsWith('/api/') || path.startsWith('/ws') || path === '/health' || path === '/info') return;

      const { resolve, normalize, sep, join } = await import('node:path');
      const { createReadStream, existsSync, statSync } = await import('node:fs');

      // Check 1: Is this a registered app? → proxy to its port
      const appRegistry = getAppRegistry();
      const registeredApp = appRegistry.get(subdomain);
      if (registeredApp) {
        const subPath = path === '/' ? '' : path.slice(1);
        const targetUrl = `http://127.0.0.1:${registeredApp.port}/${subPath}`;
        try {
          const headers: Record<string, string> = {};
          if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'] as string;
          if (request.headers['accept']) headers['accept'] = request.headers['accept'] as string;

          const fetchOpts: RequestInit = { method: request.method, headers };
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            fetchOpts.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
          }

          const proxyRes = await fetch(targetUrl, fetchOpts);
          reply.status(proxyRes.status);
          const ct = proxyRes.headers.get('content-type');
          if (ct) reply.header('Content-Type', ct);
          reply.header('Access-Control-Allow-Origin', '*');
          const body = await proxyRes.text();
          reply.send(body);
        } catch {
          reply.status(502).send({ error: `App "${subdomain}" not running on port ${registeredApp.port}` });
        }
        return;
      }

      // Check 2: Is this a workspace site directory? → serve static files
      const workspaceDir = resolve(process.cwd(), '.forgeai', 'workspace');
      const siteDir = resolve(workspaceDir, subdomain);

      if (!existsSync(siteDir) || !statSync(siteDir).isDirectory()) {
        // No site/app found for this subdomain — let it fall through to normal routing
        return;
      }

      // Security: prevent directory traversal
      if (!normalize(siteDir).startsWith(workspaceDir + sep)) {
        reply.status(403).send({ error: 'Access denied' });
        return;
      }

      // Resolve file path within the site directory
      const urlPath = path === '/' ? '' : path.slice(1);
      let filePath = normalize(resolve(siteDir, urlPath));

      // Prevent traversal outside site dir
      if (!filePath.startsWith(siteDir + sep) && filePath !== siteDir) {
        reply.status(403).send({ error: 'Access denied' });
        return;
      }

      // Directory → try index.html
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        const indexPath = join(filePath, 'index.html');
        if (existsSync(indexPath)) {
          filePath = indexPath;
        } else {
          reply.status(404).send({ error: 'No index.html found' });
          return;
        }
      }

      if (!existsSync(filePath)) {
        // SPA fallback: try site root index.html
        const rootIndex = join(siteDir, 'index.html');
        if (existsSync(rootIndex)) {
          filePath = rootIndex;
        } else {
          reply.status(404).send({ error: 'File not found' });
          return;
        }
      }

      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const mimeTypes: Record<string, string> = {
        html: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', txt: 'text/plain',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
        woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
        mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.send(createReadStream(filePath));
    });

    logger.info('Subdomain routing middleware registered');
  }

  /**
   * Load SMTP config from Vault on startup (overrides env vars).
   */
  private loadSMTPFromVault(): void {
    if (!this.vault.isInitialized()) return;
    const host = this.vault.get('system:smtp_host');
    const user = this.vault.get('system:smtp_user');
    const pass = this.vault.get('system:smtp_pass');
    if (!host || !user || !pass) return;

    const port = Number(this.vault.get('system:smtp_port')) || 587;
    const from = this.vault.get('system:smtp_from') || `ForgeAI <${user}>`;

    this.emailOTP.configure({ host, port, secure: port === 465, user, pass, from });
    logger.info('📧 SMTP loaded from Vault — email OTP active');
  }

  /**
   * SMTP configuration API routes (Dashboard UI).
   */
  private registerSMTPRoutes(): void {
    // GET /api/smtp/config — current SMTP status
    this.app.get('/api/smtp/config', async () => {
      const vaultOk = this.vault.isInitialized();
      const host = (vaultOk && this.vault.get('system:smtp_host')) || process.env['SMTP_HOST'] || '';
      const port = (vaultOk && this.vault.get('system:smtp_port')) || process.env['SMTP_PORT'] || '587';
      const user = (vaultOk && this.vault.get('system:smtp_user')) || process.env['SMTP_USER'] || '';
      const from = (vaultOk && this.vault.get('system:smtp_from')) || process.env['SMTP_FROM'] || '';
      const adminEmail = this.getAdminEmail() || '';
      const hasPass = !!(vaultOk && this.vault.get('system:smtp_pass')) || !!process.env['SMTP_PASS'];

      return {
        configured: this.emailOTP.isConfigured(),
        host,
        port,
        user,
        from,
        adminEmail,
        hasPassword: hasPass,
        source: vaultOk && this.vault.get('system:smtp_host') ? 'vault' : (process.env['SMTP_HOST'] ? 'env' : 'none'),
      };
    });

    // POST /api/smtp/config — save SMTP config to Vault + hot-reload
    this.app.post('/api/smtp/config', async (request: FastifyRequest) => {
      const body = request.body as {
        host?: string; port?: number; user?: string; pass?: string;
        from?: string; adminEmail?: string;
      };

      if (!body.host || !body.user) {
        return { error: 'SMTP host and user are required' };
      }

      if (!this.vault.isInitialized()) {
        return { error: 'Vault not initialized' };
      }

      // Save to Vault
      this.vault.set('system:smtp_host', body.host.trim());
      this.vault.set('system:smtp_port', String(body.port || 587));
      this.vault.set('system:smtp_user', body.user.trim());
      if (body.pass) this.vault.set('system:smtp_pass', body.pass.trim());
      if (body.from) this.vault.set('system:smtp_from', body.from.trim());
      if (body.adminEmail) this.vault.set('system:admin_email', body.adminEmail.trim());

      // Hot-reload SMTP
      const pass = body.pass?.trim() || this.vault.get('system:smtp_pass') || '';
      const port = body.port || 587;
      this.emailOTP.configure({
        host: body.host.trim(),
        port,
        secure: port === 465,
        user: body.user.trim(),
        pass,
        from: body.from?.trim() || `ForgeAI <${body.user.trim()}>`,
      });

      logger.info('SMTP configured via Dashboard', { host: body.host, user: body.user });

      this.auditLogger.log({
        action: 'config.update',
        ipAddress: 'dashboard',
        details: { type: 'smtp_config', host: body.host },
        success: true,
        riskLevel: 'medium',
      });

      return { success: true, configured: true };
    });

    // POST /api/smtp/test — test SMTP connection (rate-limited: 5 req/min)
    this.app.post('/api/smtp/test', async (request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = request.ip || 'unknown';
      const rlResult = this.sensitiveRateLimiter.consume(`smtp-test:${clientIp}`);
      if (!rlResult.allowed) {
        reply.status(429);
        return { ok: false, error: 'Too many test requests. Please wait 1 minute.' };
      }

      if (!this.emailOTP.isConfigured()) {
        return { ok: false, error: 'SMTP not configured. Save settings first.' };
      }
      return this.emailOTP.testConnection();
    });

    // DELETE /api/smtp/config — remove SMTP config from Vault
    this.app.delete('/api/smtp/config', async () => {
      if (this.vault.isInitialized()) {
        for (const key of ['system:smtp_host', 'system:smtp_port', 'system:smtp_user', 'system:smtp_pass', 'system:smtp_from', 'system:admin_email']) {
          this.vault.delete(key);
        }
      }
      // Re-init from env vars if available
      this.emailOTP.configureFromEnv();
      logger.info('SMTP config removed from Vault');
      return { success: true, configured: this.emailOTP.isConfigured() };
    });
  }

  /**
   * First-run setup wizard — guides admin through SMTP, 2FA, and PIN setup.
   * Only accessible when system:2fa_secret is not yet in Vault.
   */
  private registerSetupWizardRoutes(): void {
    // Temporary storage for setup 2FA secret (not yet saved to Vault)
    let pendingSetupSecret: string | null = null;

    // GET /setup — serve the wizard HTML
    this.app.get('/setup', async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!this.isFirstRun()) {
        reply.redirect('/auth/access');
        return;
      }
      reply.header('Content-Type', 'text/html');
      return reply.send(this.getSetupWizardHTML());
    });

    // POST /api/setup/smtp — save SMTP config and test
    this.app.post('/api/setup/smtp', async (request: FastifyRequest) => {
      if (!this.isFirstRun()) return { error: 'Setup already completed' };

      const body = request.body as {
        host?: string; port?: number; user?: string; pass?: string;
        from?: string; adminEmail?: string;
      };

      if (!body.host || !body.user || !body.pass) {
        return { error: 'SMTP host, user, and password are required' };
      }

      if (!body.adminEmail) {
        return { error: 'Admin email is required (this is where OTP codes will be sent)' };
      }

      if (!this.vault.isInitialized()) {
        return { error: 'Vault not initialized. Check VAULT_MASTER_PASSWORD env var.' };
      }

      // Save to Vault
      const port = body.port || 587;
      this.vault.set('system:smtp_host', body.host.trim());
      this.vault.set('system:smtp_port', String(port));
      this.vault.set('system:smtp_user', body.user.trim());
      this.vault.set('system:smtp_pass', body.pass.trim());
      this.vault.set('system:smtp_from', body.from?.trim() || `ForgeAI <${body.user.trim()}>`);
      this.vault.set('system:admin_email', body.adminEmail.trim());

      // Hot-reload SMTP
      this.emailOTP.configure({
        host: body.host.trim(),
        port,
        secure: port === 465,
        user: body.user.trim(),
        pass: body.pass.trim(),
        from: body.from?.trim() || `ForgeAI <${body.user.trim()}>`,
      });

      // Test connection
      const test = await this.emailOTP.testConnection();
      if (!test.ok) {
        return { success: false, error: `SMTP connection failed: ${test.error}` };
      }

      logger.info('SMTP configured via setup wizard', { host: body.host });
      return { success: true, message: 'SMTP configured and tested successfully!' };
    });

    // POST /api/setup/init-2fa — generate 2FA secret + QR code
    this.app.post('/api/setup/init-2fa', async () => {
      if (!this.isFirstRun()) return { error: 'Setup already completed' };

      const setup = this.twoFactor.generateSetup('admin');
      pendingSetupSecret = setup.secret;

      const qrDataUri = await QRCode.toDataURL(setup.otpauthUrl, { width: 250, margin: 2 });

      return {
        qrCode: qrDataUri,
        secret: setup.secret,
        otpauthUrl: setup.otpauthUrl,
      };
    });

    // POST /api/setup/complete — verify TOTP + save 2FA secret + set new PIN
    this.app.post('/api/setup/complete', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!this.isFirstRun()) return { error: 'Setup already completed' };

      const body = request.body as { code?: string; newPin?: string; confirmPin?: string };

      if (!body.code || !body.newPin || !body.confirmPin) {
        return { error: 'TOTP code, new PIN, and confirm PIN are all required' };
      }

      if (!pendingSetupSecret) {
        return { error: 'No 2FA secret generated. Go back to Step 2.' };
      }

      if (!this.vault.isInitialized()) {
        return { error: 'Vault not initialized' };
      }

      // Validate PIN
      const newPin = body.newPin.trim();
      const confirmPin = body.confirmPin.trim();

      if (newPin.length < 6) {
        return { error: 'PIN must be at least 6 characters.' };
      }
      if (newPin !== confirmPin) {
        return { error: 'PINs do not match.' };
      }

      // Verify TOTP code
      const isValid = this.twoFactor.verify(body.code.trim(), pendingSetupSecret);
      if (!isValid) {
        return { error: 'Invalid TOTP code. Make sure your authenticator app is synced.' };
      }

      // Save 2FA secret to Vault
      this.vault.set('system:2fa_secret', pendingSetupSecret);
      pendingSetupSecret = null;

      // Save custom PIN to Vault
      this.vault.set('system:admin_pin', newPin);

      logger.info('First-run setup completed — 2FA + PIN configured');

      this.auditLogger.log({
        action: 'auth.2fa_verified',
        ipAddress: request.ip,
        details: { type: 'first_run_setup' },
        success: true,
        riskLevel: 'medium',
      });

      this.auditLogger.log({
        action: 'auth.pin_changed',
        ipAddress: request.ip,
        details: { type: 'first_run_setup' },
        success: true,
        riskLevel: 'medium',
      });

      // Issue JWT session and return success (frontend will redirect)
      const tokenPair = this.auth.generateTokenPair({
        userId: 'admin',
        username: 'admin',
        role: UserRole.ADMIN,
        sessionId: `setup-${Date.now()}`,
      });
      reply.header('Set-Cookie', `forgeai_session=${tokenPair.accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);

      return { success: true, message: 'Setup complete! Redirecting to dashboard...' };
    });
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

    // Check query param (for WebSocket connections that can't send headers)
    if (!token) {
      const query = (request.query || {}) as Record<string, string>;
      if (query.token) {
        token = query.token;
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
      <h3>Quick Access — Paste Token</h3>
      <form method="GET" action="/auth/access" style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" name="token" required placeholder="Paste your access token here..." style="flex:1;background:#000;border:1px solid #333;border-radius:8px;padding:10px 14px;color:#4ade80;font-family:'Fira Code',monospace;font-size:13px;outline:none;">
        <button type="submit" style="background:#ff6b35;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap;">Go</button>
      </form>
    </div>
    <div class="instruction">
      <h3>How to get a token</h3>
      <p class="step"><strong>1.</strong> Connect to your server via SSH</p>
      <p class="step"><strong>2.</strong> Run the following command:</p>
      <div class="code-block">curl -s -X POST http://127.0.0.1:${this.port}/api/auth/generate-access | jq</div>
      <p class="step" style="margin-top:12px;"><strong>3.</strong> Copy the <strong>token</strong> value and paste it above</p>
      <p class="step"><strong>4.</strong> Or open the <strong>accessUrl</strong> directly (replace 127.0.0.1 with your server IP if remote)</p>
    </div>
    <hr class="divider">
    <p class="footer">Access tokens expire in 5 minutes · Sessions last 24h · IP lockout after 10 failed attempts</p>
  </div>
</body>
</html>`;
  }

  private registerWSRoutes(): void {
    const broadcaster = getWSBroadcaster();
    const companionBridge = getCompanionBridge();

    this.app.get('/ws', { websocket: true }, (socket, request) => {
      const client = broadcaster.addClient(socket as any);

      // Track Companion connections by companionId query param
      const query = (request.query || {}) as Record<string, string>;
      const companionId = query.companionId || '';
      logger.info('WS connection opened', { url: request.url, companionId: companionId || '(none)', queryKeys: Object.keys(query).join(',') || '(empty)' });
      if (companionId) {
        companionBridge.registerCompanion(companionId, socket);
        logger.info('Companion WS registered in bridge', { companionId });
      }

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

            // Companion sends back action execution results
            case 'action_result':
              if (message.requestId) {
                companionBridge.handleActionResult(message.requestId, {
                  success: !!message.success,
                  output: message.output || '',
                });
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
        if (companionId) {
          companionBridge.unregisterCompanion(companionId);
        }
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
        const publicUrl = process.env['PUBLIC_URL'];
        const displayHost = publicUrl
          ? publicUrl.replace(/\/$/, '')
          : `http://${this.host === '0.0.0.0' ? '127.0.0.1' : this.host}:${this.port}`;
        const accessUrl = `${displayHost}/auth/access?token=${token}`;
        logger.info(`🔑 Dashboard access URL (valid 5 min):`);
        logger.info(`   ${accessUrl}`);
        if (!publicUrl && this.host === '0.0.0.0') {
          logger.info(`   💡 Remote? Replace 127.0.0.1 with your server IP, or set PUBLIC_URL env var`);
        }
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
    this.sensitiveRateLimiter.destroy();
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
