import { createLogger } from '@forgeai/shared';

const logger = createLogger('Agent:AutoPlanner');

export interface PlanStep {
  id: string;
  description: string;
  type: 'action' | 'decision' | 'parallel' | 'loop';
  status: string;
  dependencies: string[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  substeps?: PlanStep[];
  startedAt?: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  totalSteps: number;
  completedSteps: number;
}

export interface PlannerConfig {
  maxSteps: number;
  maxDepth: number;
  parallelExecution: boolean;
  retryOnFailure: boolean;
  maxRetries: number;
}

export type ToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

export class AutoPlanner {
  private plans: Map<string, Plan> = new Map();
  private config: PlannerConfig;
  private planCounter = 0;

  constructor(config?: Partial<PlannerConfig>) {
    this.config = {
      maxSteps: config?.maxSteps ?? 20,
      maxDepth: config?.maxDepth ?? 3,
      parallelExecution: config?.parallelExecution ?? true,
      retryOnFailure: config?.retryOnFailure ?? true,
      maxRetries: config?.maxRetries ?? 2,
    };
    logger.info('Auto-planner initialized', { maxSteps: this.config.maxSteps });
  }

  createPlan(goal: string, steps: Array<{
    description: string;
    type?: PlanStep['type'];
    dependencies?: string[];
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    substeps?: Array<{ description: string; toolName?: string; toolArgs?: Record<string, unknown> }>;
  }>): Plan {
    const planId = `plan-${++this.planCounter}-${Date.now()}`;

    const planSteps: PlanStep[] = steps.slice(0, this.config.maxSteps).map((s, i) => ({
      id: `${planId}:step-${i}`,
      description: s.description,
      type: s.type ?? 'action',
      status: 'pending' as const,
      dependencies: s.dependencies ?? [],
      toolName: s.toolName,
      toolArgs: s.toolArgs,
      substeps: s.substeps?.map((sub, j) => ({
        id: `${planId}:step-${i}:sub-${j}`,
        description: sub.description,
        type: 'action' as const,
        status: 'pending' as const,
        dependencies: [],
        toolName: sub.toolName,
        toolArgs: sub.toolArgs,
      })),
    }));

    const plan: Plan = {
      id: planId,
      goal,
      steps: planSteps,
      status: 'planning',
      createdAt: Date.now(),
      totalSteps: planSteps.length,
      completedSteps: 0,
    };

    this.plans.set(planId, plan);
    logger.info('Plan created', { id: planId, goal, steps: planSteps.length });
    return plan;
  }

  async executePlan(planId: string, executor: ToolExecutor): Promise<Plan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan '${planId}' not found`);

    plan.status = 'executing';
    logger.info('Executing plan', { id: planId, goal: plan.goal });

    try {
      for (const step of plan.steps) {
        // Check dependencies
        const depsOk = step.dependencies.every(depId => {
          const dep = plan.steps.find(s => s.id === depId);
          return dep && dep.status === 'completed';
        });

        if (!depsOk) {
          step.status = 'skipped';
          logger.warn('Step skipped (unmet dependencies)', { stepId: step.id });
          continue;
        }

        await this.executeStep(step, executor);

        if (step.status === 'completed') {
          plan.completedSteps++;
        } else if (step.status === 'failed') {
          if (!this.config.retryOnFailure) {
            plan.status = 'failed';
            break;
          }
          // Retry
          let retried = false;
          for (let r = 0; r < this.config.maxRetries; r++) {
            step.status = 'pending';
            step.error = undefined;
            await this.executeStep(step, executor);
            if (step.status === 'completed') {
              plan.completedSteps++;
              retried = true;
              break;
            }
          }
          if (!retried) {
            plan.status = 'failed';
            break;
          }
        }
      }

      if (plan.status !== 'failed') {
        plan.status = 'completed';
      }
    } catch (err) {
      plan.status = 'failed';
      logger.error('Plan execution failed', { id: planId, error: String(err) });
    }

    plan.completedAt = Date.now();
    logger.info('Plan finished', { id: planId, status: plan.status, completed: plan.completedSteps, total: plan.totalSteps });
    return plan;
  }

  private async executeStep(step: PlanStep, executor: ToolExecutor): Promise<void> {
    step.status = 'running';
    step.startedAt = Date.now();

    try {
      if (step.type === 'parallel' && step.substeps) {
        const promises = step.substeps.map(sub => this.executeStep(sub, executor));
        await Promise.allSettled(promises);
        const allDone = step.substeps.every(s => s.status === 'completed');
        step.status = allDone ? 'completed' : 'failed';
      } else if (step.toolName) {
        step.result = await executor(step.toolName, step.toolArgs ?? {});
        step.status = 'completed';
      } else {
        // No tool — mark as completed (informational step)
        step.status = 'completed';
      }
    } catch (err) {
      step.status = 'failed';
      step.error = err instanceof Error ? err.message : String(err);
    }

    step.completedAt = Date.now();
  }

  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  listPlans(): Array<{ id: string; goal: string; status: string; steps: number; completed: number; createdAt: number }> {
    return Array.from(this.plans.values()).map(p => ({
      id: p.id,
      goal: p.goal,
      status: p.status,
      steps: p.totalSteps,
      completed: p.completedSteps,
      createdAt: p.createdAt,
    }));
  }

  deletePlan(planId: string): boolean {
    return this.plans.delete(planId);
  }

  getConfig(): PlannerConfig {
    return { ...this.config };
  }
}

export function createAutoPlanner(config?: Partial<PlannerConfig>): AutoPlanner {
  return new AutoPlanner(config);
}
