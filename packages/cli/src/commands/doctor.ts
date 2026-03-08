import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createConnection } from 'node:net';
import { APP_NAME } from '@forgeai/shared';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

interface CheckSection {
  title: string;
  emoji: string;
  checks: CheckResult[];
}

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(`Diagnose ${APP_NAME} installation and configuration`)
    .action(async () => {
      console.log(`\n🩺 ${APP_NAME} Doctor — checking your setup...\n`);

      const sections: CheckSection[] = [];

      // ─── Section 1: Runtime ─────────────────────────
      const runtime: CheckResult[] = [];

      // Node.js version
      const nodeVersion = process.versions.node;
      const major = Number(nodeVersion.split('.')[0]);
      runtime.push({
        name: 'Node.js version',
        status: major >= 22 ? 'pass' : major >= 20 ? 'warn' : 'fail',
        message: major >= 22
          ? `v${nodeVersion} ✓`
          : major >= 20
            ? `v${nodeVersion} — recommended ≥22`
            : `v${nodeVersion} — required ≥22`,
      });

      // pnpm
      const pnpmVersion = tryExec('pnpm', ['--version']);
      runtime.push({
        name: 'pnpm',
        status: pnpmVersion ? 'pass' : 'warn',
        message: pnpmVersion ? `v${pnpmVersion} ✓` : 'Not found — install with: npm i -g pnpm',
      });

      // Python 3
      const py3 = tryExec('python3', ['--version']) ?? tryExec('python', ['--version']);
      runtime.push({
        name: 'Python 3',
        status: py3 && py3.includes('3.') ? 'pass' : 'warn',
        message: py3 ? `${py3} ✓` : 'Not found — some tools need Python (shell_exec, venv)',
      });

      // Git
      const gitVersion = tryExec('git', ['--version']);
      runtime.push({
        name: 'Git',
        status: gitVersion ? 'pass' : 'warn',
        message: gitVersion ? `${gitVersion} ✓` : 'Not found — needed for project management tools',
      });

      sections.push({ title: 'Runtime', emoji: '⚙️', checks: runtime });

      // ─── Section 2: Configuration ───────────────────
      const config: CheckResult[] = [];

      // .env file
      const envPath = resolve(process.cwd(), '.env');
      config.push({
        name: '.env file',
        status: existsSync(envPath) ? 'pass' : 'warn',
        message: existsSync(envPath) ? `Found at ${envPath}` : 'Not found — copy .env.example to .env',
      });

      // Required environment variables
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

        config.push({
          name: envVar,
          status: !value ? 'fail' : isDefault ? 'warn' : 'pass',
          message: !value
            ? 'Not set'
            : isDefault
              ? 'Still using default value — change it!'
              : 'Set ✓',
        });
      }

      // JWT secret strength
      const jwtSecret = process.env['JWT_SECRET'] || '';
      config.push({
        name: 'JWT secret strength',
        status: jwtSecret.length >= 64 ? 'pass' : jwtSecret.length >= 32 ? 'warn' : 'fail',
        message: jwtSecret.length >= 64
          ? `${jwtSecret.length} chars ✓`
          : jwtSecret.length >= 32
            ? `${jwtSecret.length} chars — recommended ≥64`
            : `${jwtSecret.length} chars — minimum 32 required`,
      });

      // Vault password strength
      const vaultPw = process.env['VAULT_MASTER_PASSWORD'] || '';
      config.push({
        name: 'Vault password strength',
        status: vaultPw.length >= 16 ? 'pass' : vaultPw.length >= 8 ? 'warn' : 'fail',
        message: vaultPw.length >= 16
          ? `${vaultPw.length} chars ✓`
          : vaultPw.length >= 8
            ? `${vaultPw.length} chars — recommended ≥16`
            : `${vaultPw.length} chars — minimum 8 required`,
      });

      sections.push({ title: 'Configuration', emoji: '🔧', checks: config });

      // ─── Section 3: LLM Providers ───────────────────
      const llm: CheckResult[] = [];

      const providers: Array<{ name: string; envKey: string; note?: string }> = [
        { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY' },
        { name: 'OpenAI (GPT)', envKey: 'OPENAI_API_KEY' },
        { name: 'Google (Gemini)', envKey: 'GOOGLE_AI_API_KEY', note: 'or GOOGLE_GENERATIVE_AI_API_KEY' },
        { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY' },
        { name: 'Groq', envKey: 'GROQ_API_KEY' },
        { name: 'Mistral', envKey: 'MISTRAL_API_KEY' },
        { name: 'xAI (Grok)', envKey: 'XAI_API_KEY' },
        { name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY' },
        { name: 'Ollama (local)', envKey: 'OLLAMA_BASE_URL', note: 'no key needed' },
        { name: 'LM Studio (local)', envKey: 'LMSTUDIO_BASE_URL', note: 'no key needed' },
      ];

      let hasAnyProvider = false;
      for (const p of providers) {
        const value = process.env[p.envKey];
        const altKey = p.name.includes('Google') ? process.env['GOOGLE_GENERATIVE_AI_API_KEY'] : undefined;
        const isSet = !!value || !!altKey;
        if (isSet) hasAnyProvider = true;

        llm.push({
          name: p.name,
          status: isSet ? 'pass' : 'warn',
          message: isSet
            ? `${p.envKey} set ✓`
            : `${p.envKey} not set${p.note ? ` (${p.note})` : ''}`,
        });
      }

      if (!hasAnyProvider) {
        llm.unshift({
          name: 'No LLM provider configured!',
          status: 'fail',
          message: 'Set at least one API key (e.g. ANTHROPIC_API_KEY or OPENAI_API_KEY)',
        });
      }

      sections.push({ title: 'LLM Providers', emoji: '🤖', checks: llm });

      // ─── Section 4: Services ────────────────────────
      const services: CheckResult[] = [];

      // MySQL connection
      try {
        const { initDatabase, closeDatabase } = await import('@forgeai/core');
        await initDatabase();
        services.push({
          name: 'MySQL connection',
          status: 'pass',
          message: `Connected to ${process.env['MYSQL_HOST'] || '127.0.0.1'}:${process.env['MYSQL_PORT'] || '3306'}`,
        });
        await closeDatabase();
      } catch (error) {
        services.push({
          name: 'MySQL connection',
          status: 'fail',
          message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // Gateway port
      const gatewayPort = Number(process.env['PORT'] || '3000');
      const gatewayUp = await checkPort(gatewayPort);
      services.push({
        name: `Gateway port :${gatewayPort}`,
        status: gatewayUp ? 'pass' : 'warn',
        message: gatewayUp ? 'Running ✓' : 'Not running (start with: forge start)',
      });

      // Dashboard port
      const dashPort = Number(process.env['DASHBOARD_PORT'] || '5173');
      const dashUp = await checkPort(dashPort);
      services.push({
        name: `Dashboard port :${dashPort}`,
        status: dashUp ? 'pass' : 'warn',
        message: dashUp ? 'Running ✓' : 'Not running',
      });

      sections.push({ title: 'Services', emoji: '📡', checks: services });

      // ─── Section 5: Workspace ───────────────────────
      const workspace: CheckResult[] = [];

      const homeDir = process.env['FORGEAI_HOME'] || join(process.env['HOME'] || process.env['USERPROFILE'] || '', '.forgeai');
      workspace.push({
        name: 'ForgeAI home',
        status: existsSync(homeDir) ? 'pass' : 'warn',
        message: existsSync(homeDir) ? `${homeDir} ✓` : `${homeDir} — will be created on first run`,
      });

      const workDir = process.env['FORGEAI_WORKSPACE'] || join(homeDir, 'workspace');
      workspace.push({
        name: 'Workspace dir',
        status: existsSync(workDir) ? 'pass' : 'warn',
        message: existsSync(workDir) ? `${workDir} ✓` : `${workDir} — will be created on first run`,
      });

      const skillsDir = join(homeDir, 'skills');
      workspace.push({
        name: 'Skills dir',
        status: existsSync(skillsDir) ? 'pass' : 'warn',
        message: existsSync(skillsDir) ? `${skillsDir} ✓` : 'Not yet created — skills will create it',
      });

      sections.push({ title: 'Workspace', emoji: '📂', checks: workspace });

      // ─── Print results ──────────────────────────────
      const icons = { pass: '✅', warn: '⚠️', fail: '❌' };
      let hasFailures = false;
      let totalPass = 0;
      let totalWarn = 0;
      let totalFail = 0;

      for (const section of sections) {
        console.log(`  ${section.emoji}  ${section.title}`);
        console.log(`  ${'─'.repeat(40)}`);

        for (const check of section.checks) {
          console.log(`  ${icons[check.status]}  ${check.name}: ${check.message}`);
          if (check.status === 'pass') totalPass++;
          else if (check.status === 'warn') totalWarn++;
          else { totalFail++; hasFailures = true; }
        }
        console.log('');
      }

      console.log(`  📊 Results: ${totalPass} passed, ${totalWarn} warnings, ${totalFail} failed`);

      if (hasFailures) {
        console.log('\n  ⚠️  Some checks failed. Fix them before running the gateway.\n');
        process.exit(1);
      } else if (totalWarn > 0) {
        console.log(`\n  ✅ ${APP_NAME} is ready! (${totalWarn} optional warnings above)\n`);
      } else {
        console.log(`\n  ✅ ${APP_NAME} — all checks passed!\n`);
      }
    });
}
