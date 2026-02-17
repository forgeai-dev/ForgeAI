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

const program = new Command();

program
  .name('forge')
  .description(`${APP_NAME} — ${APP_DESCRIPTION}`)
  .version(APP_VERSION);

registerStartCommand(program);
registerDoctorCommand(program);
registerStatusCommand(program);
registerOnboardCommand(program);

program.parse();
