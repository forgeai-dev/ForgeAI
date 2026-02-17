import type { Command } from 'commander';
import { APP_NAME } from '@forgeai/shared';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description(`Check ${APP_NAME} Gateway status`)
    .option('-H, --host <host>', 'Gateway host', process.env['GATEWAY_HOST'] || '127.0.0.1')
    .option('-p, --port <port>', 'Gateway port', process.env['GATEWAY_PORT'] || '18800')
    .action(async (options: { host: string; port: string }) => {
      const url = `http://${options.host}:${options.port}`;

      console.log(`\n🔍 Checking ${APP_NAME} Gateway at ${url}...\n`);

      try {
        const healthRes = await fetch(`${url}/health`);
        const health = await healthRes.json() as Record<string, unknown>;

        const infoRes = await fetch(`${url}/info`);
        const info = await infoRes.json() as Record<string, unknown>;

        console.log(`  Status:  ${health['status'] === 'healthy' ? '✅ Healthy' : '⚠️ ' + String(health['status'])}`);
        console.log(`  Version: ${info['version']}`);
        console.log(`  Uptime:  ${formatUptime(Number(health['uptime']))}`);

        const security = info['security'] as Record<string, boolean> | undefined;
        if (security) {
          console.log(`\n  🛡️ Security Modules:`);
          for (const [mod, active] of Object.entries(security)) {
            console.log(`    ${active ? '✅' : '❌'} ${mod}`);
          }
        }

        const checks = health['checks'] as Array<{ name: string; status: string }> | undefined;
        if (checks) {
          console.log(`\n  🏥 Health Checks:`);
          for (const check of checks) {
            const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
            console.log(`    ${icon} ${check.name}`);
          }
        }

        console.log('');
      } catch {
        console.log(`  ❌ Gateway is not reachable at ${url}`);
        console.log(`     Make sure it's running: forge start\n`);
        process.exit(1);
      }
    });
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
