import type { Command } from 'commander';
import { resolve } from 'node:path';
import { createGateway } from '@forgeai/core';
import { initDatabase, runMigrations } from '@forgeai/core';
import { MySQLAuditStore } from '@forgeai/core';
import { APP_NAME } from '@forgeai/shared';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description(`Start the ${APP_NAME} Gateway`)
    .option('-H, --host <host>', 'Gateway host', process.env['GATEWAY_HOST'] || '127.0.0.1')
    .option('-p, --port <port>', 'Gateway port', process.env['GATEWAY_PORT'] || '18800')
    .option('--migrate', 'Run database migrations before starting', false)
    .option('--verbose', 'Enable verbose logging', false)
    .action(async (options: { host: string; port: string; migrate: boolean; verbose: boolean }) => {
      console.log(`\n🔥 Starting ${APP_NAME} Gateway...\n`);

      const jwtSecret = process.env['JWT_SECRET'];
      const vaultPassword = process.env['VAULT_MASTER_PASSWORD'];

      if (!jwtSecret || jwtSecret === 'change-me-to-a-random-jwt-secret') {
        console.error('❌ JWT_SECRET not set or still default. Set it in your .env file.');
        process.exit(1);
      }

      if (!vaultPassword || vaultPassword === 'change-me-to-a-strong-password') {
        console.error('❌ VAULT_MASTER_PASSWORD not set or still default. Set it in your .env file.');
        process.exit(1);
      }

      try {
        // Initialize database
        console.log('📦 Connecting to MySQL...');
        const db = await initDatabase();

        if (options.migrate) {
          console.log('🔄 Running migrations...');
          await runMigrations();
        }

        // Create gateway
        const gateway = createGateway({
          host: options.host,
          port: Number(options.port),
          jwtSecret,
          vaultPassword,
          rateLimitWindowMs: Number(process.env['RATE_LIMIT_WINDOW_MS']) || 60_000,
          rateLimitMaxRequests: Number(process.env['RATE_LIMIT_MAX_REQUESTS']) || 60,
        });

        // Connect audit logger to MySQL
        const auditStore = new MySQLAuditStore(db);
        gateway.auditLogger.setStore(auditStore);

        // Initialize vault with file persistence
        const vaultFilePath = resolve(process.cwd(), '.forgeai', 'vault.json');
        console.log('🔐 Initializing Vault...');
        await gateway.vault.initialize(vaultPassword, undefined, vaultFilePath);

        // Initialize and start
        await gateway.initialize();
        await gateway.start();

        const g = '\x1b[90m';
        const w = '\x1b[97m';
        const o = '\x1b[38;5;208m';
        const gr = '\x1b[32m';
        const r = '\x1b[0m';

        console.log(`${gr}  Gateway is running!${r}`);
        console.log(`${g}  ──────────────────────────────────────────────${r}`);
        console.log(`${w}  HTTP${g}  ${o}http://${options.host}:${options.port}${r}`);
        console.log(`${w}  WS${g}    ${o}ws://${options.host}:${options.port}/ws${r}`);
        console.log(`${g}  ──────────────────────────────────────────────${r}`);
        console.log(`${w}  Security${g}  RBAC ${gr}✓${g} | Vault ${gr}✓${g} | RateLimit ${gr}✓${g} | PromptGuard ${gr}✓${r}`);
        console.log(`${g}            AuditLog ${gr}✓${g} | InputSanitizer ${gr}✓${g} | 2FA ${gr}✓${r}`);
        console.log('');

        // Graceful shutdown
        const shutdown = async () => {
          console.log('\n🛑 Shutting down...');
          await gateway.stop();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

      } catch (error) {
        console.error('❌ Failed to start gateway:', error);
        process.exit(1);
      }
    });
}
