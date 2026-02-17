import type { Command } from 'commander';
import { APP_NAME } from '@forgeai/shared';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(`Diagnose ${APP_NAME} installation and configuration`)
    .action(async () => {
      console.log(`\n🩺 ${APP_NAME} Doctor — checking your setup...\n`);

      const checks: CheckResult[] = [];

      // Check Node.js version
      const nodeVersion = process.versions.node;
      const major = Number(nodeVersion.split('.')[0]);
      checks.push({
        name: 'Node.js version',
        status: major >= 22 ? 'pass' : major >= 20 ? 'warn' : 'fail',
        message: major >= 22
          ? `v${nodeVersion} ✓`
          : major >= 20
            ? `v${nodeVersion} — recommended ≥22`
            : `v${nodeVersion} — required ≥22`,
      });

      // Check environment variables
      const requiredEnvVars = [
        'JWT_SECRET',
        'VAULT_MASTER_PASSWORD',
        'MYSQL_HOST',
        'MYSQL_DATABASE',
      ];

      for (const envVar of requiredEnvVars) {
        const value = process.env[envVar];
        const isDefault = value === 'change-me-to-a-random-jwt-secret'
          || value === 'change-me-to-a-strong-password'
          || value === 'change-me-to-a-random-secret';

        checks.push({
          name: envVar,
          status: !value ? 'fail' : isDefault ? 'warn' : 'pass',
          message: !value
            ? 'Not set'
            : isDefault
              ? 'Still using default value — change it!'
              : 'Set ✓',
        });
      }

      // Check MySQL connection
      try {
        const { initDatabase, closeDatabase } = await import('@forgeai/core');
        await initDatabase();
        checks.push({
          name: 'MySQL connection',
          status: 'pass',
          message: `Connected to ${process.env['MYSQL_HOST'] || '127.0.0.1'}:${process.env['MYSQL_PORT'] || '3306'}`,
        });
        await closeDatabase();
      } catch (error) {
        checks.push({
          name: 'MySQL connection',
          status: 'fail',
          message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // Check JWT secret strength
      const jwtSecret = process.env['JWT_SECRET'] || '';
      checks.push({
        name: 'JWT secret strength',
        status: jwtSecret.length >= 64 ? 'pass' : jwtSecret.length >= 32 ? 'warn' : 'fail',
        message: jwtSecret.length >= 64
          ? `${jwtSecret.length} chars ✓`
          : jwtSecret.length >= 32
            ? `${jwtSecret.length} chars — recommended ≥64`
            : `${jwtSecret.length} chars — minimum 32 required`,
      });

      // Check Vault password strength
      const vaultPw = process.env['VAULT_MASTER_PASSWORD'] || '';
      checks.push({
        name: 'Vault password strength',
        status: vaultPw.length >= 16 ? 'pass' : vaultPw.length >= 8 ? 'warn' : 'fail',
        message: vaultPw.length >= 16
          ? `${vaultPw.length} chars ✓`
          : vaultPw.length >= 8
            ? `${vaultPw.length} chars — recommended ≥16`
            : `${vaultPw.length} chars — minimum 8 required`,
      });

      // Print results
      const icons = { pass: '✅', warn: '⚠️', fail: '❌' };
      let hasFailures = false;

      for (const check of checks) {
        console.log(`  ${icons[check.status]}  ${check.name}: ${check.message}`);
        if (check.status === 'fail') hasFailures = true;
      }

      const passCount = checks.filter(c => c.status === 'pass').length;
      const warnCount = checks.filter(c => c.status === 'warn').length;
      const failCount = checks.filter(c => c.status === 'fail').length;

      console.log(`\n📊 Results: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);

      if (hasFailures) {
        console.log('\n⚠️  Some checks failed. Fix them before running the gateway.\n');
        process.exit(1);
      } else {
        console.log(`\n✅ ${APP_NAME} is ready to go!\n`);
      }
    });
}
