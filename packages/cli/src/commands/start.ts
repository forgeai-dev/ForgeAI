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

        console.log(`\n✅ ${APP_NAME} Gateway is running!`);
        console.log(`   HTTP: http://${options.host}:${options.port}`);
        console.log(`   WS:   ws://${options.host}:${options.port}/ws`);
        console.log(`\n🛡️  Security modules active:`);
        console.log(`   • RBAC Engine        ✓`);
        console.log(`   • Credential Vault   ✓`);
        console.log(`   • Rate Limiter       ✓`);
        console.log(`   • Prompt Guard       ✓`);
        console.log(`   • Input Sanitizer    ✓`);
        console.log(`   • Audit Logger       ✓`);
        console.log(`   • 2FA Support        ✓`);
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
