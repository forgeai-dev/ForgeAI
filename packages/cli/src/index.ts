#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { APP_NAME, APP_VERSION, APP_DESCRIPTION } from '@forgeai/shared';
import { registerStartCommand } from './commands/start.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerStatusCommand } from './commands/status.js';
import { registerOnboardCommand } from './commands/onboard.js';

// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });

// ─── ASCII Banner ───
export function printBanner(): void {
  const o = '\x1b[38;5;208m'; // orange
  const d = '\x1b[38;5;166m'; // dark orange
  const w = '\x1b[97m';       // white
  const g = '\x1b[90m';       // gray
  const r = '\x1b[0m';        // reset

  console.log('');
  console.log(`${o}  ███████  ██████  ██████   ██████  ███████     ${d} █████  ██${r}`);
  console.log(`${o}  ██      ██    ██ ██   ██ ██       ██          ${d}██   ██ ██${r}`);
  console.log(`${o}  █████   ██    ██ ██████  ██   ███ █████       ${d}███████ ██${r}`);
  console.log(`${o}  ██      ██    ██ ██   ██ ██    ██ ██          ${d}██   ██ ██${r}`);
  console.log(`${o}  ██       ██████  ██   ██  ██████  ███████     ${d}██   ██ ██${r}`);
  console.log('');
  console.log(`${g}  ──────────────────────────────────────────────────────────${r}`);
  console.log(`${w}  Open-Source AI Agent Platform${g}  ·  ${w}v${APP_VERSION}${r}`);
  console.log(`${g}  10 LLM Providers · 13 Tools · 7 Channels · Security-First${r}`);
  console.log(`${g}  ──────────────────────────────────────────────────────────${r}`);
  console.log('');
}

const program = new Command();

program
  .name('forge')
  .description(`${APP_NAME} \u2014 ${APP_DESCRIPTION}`)
  .version(APP_VERSION)
  .hook('preAction', () => {
    printBanner();
  });

registerStartCommand(program);
registerDoctorCommand(program);
registerStatusCommand(program);
registerOnboardCommand(program);

// Show banner when running `forge` with no args
if (process.argv.length <= 2) {
  printBanner();
}

program.parse();
