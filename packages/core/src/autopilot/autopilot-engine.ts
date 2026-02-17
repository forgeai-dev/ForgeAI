import { createLogger } from '@forgeai/shared';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const logger = createLogger('Core:Autopilot');

// ─── Types ────────────────────────────
export interface AutopilotTask {
  id: string;
  text: string;
  schedule: 'startup' | 'hourly' | 'morning' | 'afternoon' | 'evening' | 'custom';
  customInterval?: number;
  category: string;
  lastRun?: Date;
  runCount: number;
  enabled: boolean;
}

export interface AutopilotConfig {
  enabled: boolean;
  intervalMinutes: number;
  filePath: string;
  deliverTo?: string;
}

export type AutopilotTaskHandler = (task: AutopilotTask) => Promise<string>;

// ─── Schedule mapping ────────────────────────────
const SCHEDULE_HOURS: Record<string, number[]> = {
  morning: [7, 8, 9],
  afternoon: [12, 13, 14],
  evening: [18, 19, 20],
};

// ─── Default template ────────────────────────────
const DEFAULT_TEMPLATE = `# 🔥 ForgeAI Autopilot
#
# Este arquivo define tarefas que o ForgeAI executa automaticamente.
# Edite livremente! O formato e simples:
#
#   ## Categoria
#   - Tarefa em linguagem natural
#
# ── Horarios ──────────────────────────
#   @startup    = Executa quando o bot inicia
#   @hourly     = A cada hora
#   @morning    = De manha (7h-9h)
#   @afternoon  = A tarde (12h-14h)
#   @evening    = A noite (18h-20h)
#
#   Se nao colocar horario, executa no intervalo
#   padrao (a cada 30 minutos).
#
# ── Exemplos ──────────────────────────
#   - @morning Verificar previsao do tempo
#   - @hourly Checar se meu site esta online
#   - @startup Dizer bom dia no Telegram
#
# ── Dicas ─────────────────────────────
#   - Linhas com # sao ignoradas
#   - Deixe vazio para desativar o Autopilot
#   - Use /autopilot no chat para ver status
#

## Rotinas Diarias
# - @morning Bom dia! Resumo do que tenho para hoje
# - @evening Resumo do dia: o que foi feito

## Monitoramento
# - @hourly Verificar se o site https://exemplo.com esta online

## Lembretes
# - @afternoon Lembrar de beber agua e fazer uma pausa
`;

// ─── Engine ────────────────────────────
export class AutopilotEngine {
  private config: AutopilotConfig;
  private tasks: AutopilotTask[] = [];
  private handler: AutopilotTaskHandler | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheck = new Date();

  constructor(config?: Partial<AutopilotConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      intervalMinutes: config?.intervalMinutes ?? 30,
      filePath: config?.filePath ?? resolve(process.cwd(), '.forgeai', 'AUTOPILOT.md'),
      deliverTo: config?.deliverTo,
    };
  }

  // ─── Public API ────────────────────────────

  setHandler(handler: AutopilotTaskHandler): void {
    this.handler = handler;
  }

  start(): void {
    if (!this.config.enabled) {
      logger.info('Autopilot disabled');
      return;
    }

    this.ensureFile();
    this.reload();

    if (this.tasks.length === 0) {
      logger.info('Autopilot: no active tasks found in AUTOPILOT.md');
      return;
    }

    logger.info(`Autopilot started: ${this.tasks.length} tasks, interval=${this.config.intervalMinutes}min`);

    // Run startup tasks
    this.runScheduled('startup');

    // Periodic check
    this.intervalId = setInterval(() => {
      this.tick();
    }, this.config.intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Autopilot stopped');
  }

  reload(): void {
    this.tasks = this.parseFile();
    logger.info(`Autopilot reloaded: ${this.tasks.length} tasks`);
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  getTasks(): AutopilotTask[] {
    return [...this.tasks];
  }

  getConfig(): AutopilotConfig {
    return { ...this.config };
  }

  getStatus(): {
    enabled: boolean;
    running: boolean;
    taskCount: number;
    intervalMinutes: number;
    lastCheck: string;
    tasks: Array<{ text: string; schedule: string; category: string; lastRun?: string; runCount: number }>;
  } {
    return {
      enabled: this.config.enabled,
      running: this.isRunning(),
      taskCount: this.tasks.length,
      intervalMinutes: this.config.intervalMinutes,
      lastCheck: this.lastCheck.toISOString(),
      tasks: this.tasks.map(t => ({
        text: t.text,
        schedule: t.schedule,
        category: t.category,
        lastRun: t.lastRun?.toISOString(),
        runCount: t.runCount,
      })),
    };
  }

  // ─── Internal ────────────────────────────

  private tick(): void {
    this.lastCheck = new Date();
    this.reload();

    const hour = new Date().getHours();

    // Run hourly tasks
    this.runScheduled('hourly');

    // Run time-based tasks
    if (SCHEDULE_HOURS['morning']?.includes(hour)) {
      this.runScheduled('morning');
    }
    if (SCHEDULE_HOURS['afternoon']?.includes(hour)) {
      this.runScheduled('afternoon');
    }
    if (SCHEDULE_HOURS['evening']?.includes(hour)) {
      this.runScheduled('evening');
    }

    // Run default (no schedule) tasks
    this.runScheduled('custom');
  }

  private async runScheduled(schedule: string): Promise<void> {
    const matching = this.tasks.filter(t => t.schedule === schedule && t.enabled);
    if (matching.length === 0) return;

    for (const task of matching) {
      // Avoid running time-based tasks more than once per window
      if (schedule !== 'startup' && schedule !== 'hourly' && schedule !== 'custom') {
        if (task.lastRun) {
          const hoursSince = (Date.now() - task.lastRun.getTime()) / 3600000;
          if (hoursSince < 2) continue;
        }
      }

      logger.info(`Autopilot running: [${task.category}] ${task.text}`);
      task.lastRun = new Date();
      task.runCount++;

      if (this.handler) {
        try {
          await this.handler(task);
        } catch (err) {
          logger.error(`Autopilot task failed: ${task.text}`, err);
        }
      }
    }
  }

  private ensureFile(): void {
    if (!existsSync(this.config.filePath)) {
      const dir = dirname(this.config.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.config.filePath, DEFAULT_TEMPLATE, 'utf-8');
      logger.info(`Autopilot template created: ${this.config.filePath}`);
    }
  }

  private parseFile(): AutopilotTask[] {
    if (!existsSync(this.config.filePath)) return [];

    const content = readFileSync(this.config.filePath, 'utf-8');
    const lines = content.split('\n');
    const tasks: AutopilotTask[] = [];
    let currentCategory = 'Geral';
    let taskIdx = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Category header
      if (trimmed.startsWith('## ')) {
        currentCategory = trimmed.slice(3).trim();
        continue;
      }

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') continue;

      // Task line: must start with - or *
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        let text = trimmed.slice(2).trim();
        let schedule: AutopilotTask['schedule'] = 'custom';

        // Parse schedule tags
        if (text.startsWith('@startup')) {
          schedule = 'startup';
          text = text.slice(8).trim();
        } else if (text.startsWith('@hourly')) {
          schedule = 'hourly';
          text = text.slice(7).trim();
        } else if (text.startsWith('@morning')) {
          schedule = 'morning';
          text = text.slice(8).trim();
        } else if (text.startsWith('@afternoon')) {
          schedule = 'afternoon';
          text = text.slice(10).trim();
        } else if (text.startsWith('@evening')) {
          schedule = 'evening';
          text = text.slice(8).trim();
        }

        if (text) {
          tasks.push({
            id: `autopilot-${taskIdx++}`,
            text,
            schedule,
            category: currentCategory,
            runCount: 0,
            enabled: true,
          });
        }
      }
    }

    return tasks;
  }
}

export function createAutopilotEngine(config?: Partial<AutopilotConfig>): AutopilotEngine {
  return new AutopilotEngine(config);
}
