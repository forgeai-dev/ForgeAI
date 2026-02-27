import cron from 'node-cron';
import { generateId } from '@forgeai/shared';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

interface ScheduledTask {
  id: string;
  expression: string;
  description: string;
  action: string;
  params: Record<string, unknown>;
  createdAt: Date;
  lastRun?: Date;
  runCount: number;
  active: boolean;
  task: cron.ScheduledTask;
}

export type TaskCallback = (task: ScheduledTask) => Promise<void>;

export class CronSchedulerTool extends BaseTool {
  private tasks: Map<string, ScheduledTask> = new Map();
  private onTaskRun: TaskCallback | null = null;
  private maxTasks = 20;

  readonly definition: ToolDefinition = {
    name: 'cron_scheduler',
    description: 'Schedule, list, and manage recurring tasks using cron expressions. Scheduled tasks will be delivered as proactive messages to the user through their active channel (Telegram, Discord, WhatsApp, WebChat, etc.). Use this for reminders, periodic checks, and automated notifications. The message will be sent directly to the user who created the task. For DYNAMIC content that changes each time (e.g. weather, news briefing, system status), use taskAction="agent_prompt" — this triggers the full agent with tools to process the message as a prompt and deliver the dynamic result.',
    category: 'scheduler',
    dangerous: true,
    parameters: [
      { name: 'action', type: 'string', description: 'Action: "schedule", "list", "cancel", "pause", "resume"', required: true },
      { name: 'expression', type: 'string', description: 'Cron expression (e.g. "*/5 * * * *" = every 5 min, "30 9 * * *" = daily at 9:30)', required: false },
      { name: 'description', type: 'string', description: 'Human-readable task description', required: false },
      { name: 'taskAction', type: 'string', description: 'What the task should do: "send_reminder" (static message), "agent_prompt" (dynamic — agent processes the message with tools each time and delivers the result), "check_url", "notify"', required: false },
      { name: 'message', type: 'string', description: 'Message content to deliver when the task fires (for reminders)', required: false },
      { name: 'taskParams', type: 'object', description: 'Additional parameters for the task action', required: false },
      { name: 'taskId', type: 'string', description: 'Task ID (for cancel/pause/resume)', required: false },
    ],
  };

  setCallback(callback: TaskCallback): void {
    this.onTaskRun = callback;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const action = String(params['action']);

    const { result, duration } = await this.timed(async () => {
      switch (action) {
        case 'schedule': {
          const expression = String(params['expression'] || '');
          const description = String(params['description'] || 'Unnamed task');
          const taskAction = String(params['taskAction'] || 'notify');
          const taskParams = (params['taskParams'] as Record<string, unknown>) || {};

          if (!cron.validate(expression)) {
            throw new Error(`Invalid cron expression: ${expression}`);
          }

          if (this.tasks.size >= this.maxTasks) {
            throw new Error(`Maximum tasks (${this.maxTasks}) reached. Cancel some tasks first.`);
          }

          const id = generateId('task');
          // Auto-capture caller context for proactive delivery
          const callerUserId = params['__userId'] as string | undefined;
          const taskMessage = String(params['message'] || '');
          const enrichedParams = {
            ...taskParams,
            ...(callerUserId ? { __userId: callerUserId } : {}),
            ...(taskMessage ? { message: taskMessage } : {}),
          };
          const scheduledTask: ScheduledTask = {
            id,
            expression,
            description,
            action: taskAction,
            params: enrichedParams,
            createdAt: new Date(),
            runCount: 0,
            active: true,
            task: cron.schedule(expression, async () => {
              const task = this.tasks.get(id);
              if (!task) return;
              task.lastRun = new Date();
              task.runCount++;
              this.logger.debug('Task executed', { id, description, runCount: task.runCount });
              if (this.onTaskRun) {
                try { await this.onTaskRun(task); } catch (e) {
                  this.logger.error('Task callback failed', e, { id });
                }
              }
            }),
          };

          this.tasks.set(id, scheduledTask);
          this.logger.info('Task scheduled', { id, expression, description });

          return {
            id,
            expression,
            description,
            action: taskAction,
            message: `Task scheduled: ${description} (${expression})`,
          };
        }

        case 'list': {
          const items = Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            expression: t.expression,
            description: t.description,
            action: t.action,
            active: t.active,
            runCount: t.runCount,
            lastRun: t.lastRun?.toISOString(),
            createdAt: t.createdAt.toISOString(),
          }));
          return { count: items.length, tasks: items };
        }

        case 'cancel': {
          const taskId = String(params['taskId'] || '');
          const task = this.tasks.get(taskId);
          if (!task) throw new Error(`Task not found: ${taskId}`);
          task.task.stop();
          this.tasks.delete(taskId);
          this.logger.info('Task cancelled', { id: taskId });
          return { cancelled: true, id: taskId };
        }

        case 'pause': {
          const taskId = String(params['taskId'] || '');
          const task = this.tasks.get(taskId);
          if (!task) throw new Error(`Task not found: ${taskId}`);
          task.task.stop();
          task.active = false;
          return { paused: true, id: taskId };
        }

        case 'resume': {
          const taskId = String(params['taskId'] || '');
          const task = this.tasks.get(taskId);
          if (!task) throw new Error(`Task not found: ${taskId}`);
          task.task.start();
          task.active = true;
          return { resumed: true, id: taskId };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    });

    return { success: true, data: result, duration };
  }

  stopAll(): void {
    for (const [id, task] of this.tasks) {
      task.task.stop();
      this.logger.debug('Task stopped', { id });
    }
    this.tasks.clear();
  }
}
