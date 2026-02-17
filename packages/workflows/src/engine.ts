import { createLogger, generateId } from '@forgeai/shared';
import { createAuditLogger, type AuditLogger } from '@forgeai/security';
import type { ToolRegistry } from '@forgeai/tools';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowRun,
  StepResult,
  ToolStepConfig,
  ConditionStepConfig,
  DelayStepConfig,
  TransformStepConfig,
  ParallelStepConfig,
} from './types.js';

const logger = createLogger('Workflow:Engine');

export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private runs: Map<string, WorkflowRun> = new Map();
  private toolRegistry: ToolRegistry;
  private auditLogger: AuditLogger;

  constructor(toolRegistry: ToolRegistry, auditLogger?: AuditLogger) {
    this.toolRegistry = toolRegistry;
    this.auditLogger = auditLogger ?? createAuditLogger();
  }

  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    logger.info(`Workflow registered: ${workflow.name} (${workflow.steps.length} steps)`);
  }

  unregister(workflowId: string): void {
    this.workflows.delete(workflowId);
  }

  get(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  listRuns(workflowId?: string): Array<{
    id: string;
    workflowId: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    duration?: number;
    stepsCompleted: number;
    stepsTotal: number;
  }> {
    const runs = workflowId
      ? Array.from(this.runs.values()).filter(r => r.workflowId === workflowId)
      : Array.from(this.runs.values());

    return runs.map(r => ({
      id: r.id,
      workflowId: r.workflowId,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
      duration: r.duration,
      stepsCompleted: Array.from(r.stepResults.values()).filter(s => s.status === 'completed').length,
      stepsTotal: r.stepResults.size,
    }));
  }

  async execute(workflowId: string, inputVars?: Record<string, unknown>): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const run: WorkflowRun = {
      id: generateId('run'),
      workflowId,
      status: 'running',
      variables: { ...workflow.variables, ...inputVars },
      stepResults: new Map(),
      startedAt: new Date(),
    };

    this.runs.set(run.id, run);

    this.auditLogger.log({
      action: 'tool.execute',
      details: { type: 'workflow.start', workflowId, runId: run.id },
      success: true,
    });

    logger.info(`Workflow started: ${workflow.name} [${run.id}]`);

    try {
      // Execute steps in order, respecting dependencies
      const executed = new Set<string>();

      for (const step of workflow.steps) {
        // Check dependencies
        if (step.dependsOn) {
          const allDepsComplete = step.dependsOn.every(dep => executed.has(dep));
          if (!allDepsComplete) {
            const result: StepResult = {
              stepId: step.id,
              status: 'skipped',
              startedAt: new Date(),
              completedAt: new Date(),
              error: 'Dependencies not met',
            };
            run.stepResults.set(step.id, result);
            continue;
          }
        }

        // Check condition gates
        if (step.type === 'condition') {
          await this.executeConditionStep(step, run);
          executed.add(step.id);
          continue;
        }

        const result = await this.executeStep(step, run);
        run.stepResults.set(step.id, result);

        if (result.status === 'failed' && step.onError !== 'skip') {
          if (step.onError === 'retry' && step.retryCount) {
            let retried = false;
            for (let i = 0; i < step.retryCount; i++) {
              logger.debug(`Retrying step ${step.id} (attempt ${i + 2})`);
              const retryResult = await this.executeStep(step, run);
              run.stepResults.set(step.id, retryResult);
              if (retryResult.status === 'completed') {
                retried = true;
                break;
              }
            }
            if (!retried) {
              run.status = 'failed';
              run.error = `Step ${step.id} failed after ${step.retryCount} retries`;
              break;
            }
          } else {
            run.status = 'failed';
            run.error = `Step ${step.id} failed: ${result.error}`;
            break;
          }
        }

        executed.add(step.id);

        // Store step output in variables
        if (result.data !== undefined) {
          run.variables[`step_${step.id}`] = result.data;
        }
      }

      if (run.status === 'running') {
        run.status = 'completed';
      }
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      logger.error(`Workflow failed: ${workflow.name}`, error);
    }

    run.completedAt = new Date();
    run.duration = run.completedAt.getTime() - run.startedAt.getTime();

    this.auditLogger.log({
      action: 'tool.execute',
      details: {
        type: 'workflow.complete',
        workflowId,
        runId: run.id,
        status: run.status,
        duration: run.duration,
      },
      success: run.status === 'completed',
    });

    logger.info(`Workflow ${run.status}: ${workflow.name} [${run.id}] in ${run.duration}ms`);
    return run;
  }

  private async executeStep(step: WorkflowStep, run: WorkflowRun): Promise<StepResult> {
    const startedAt = new Date();

    try {
      let data: unknown;

      switch (step.type) {
        case 'tool': {
          const config = step.config as ToolStepConfig;
          const resolvedParams = this.resolveVariables(config.params, run.variables);
          const result = await this.toolRegistry.execute(config.toolName, resolvedParams);
          if (!result.success) throw new Error(result.error);
          data = result.data;
          break;
        }

        case 'delay': {
          const config = step.config as DelayStepConfig;
          await new Promise(resolve => setTimeout(resolve, Math.min(config.ms, 30_000)));
          data = { delayed: config.ms };
          break;
        }

        case 'transform': {
          const config = step.config as TransformStepConfig;
          const fn = new Function('variables', 'steps', config.code);
          data = fn(run.variables, Object.fromEntries(run.stepResults));
          break;
        }

        case 'parallel': {
          const config = step.config as ParallelStepConfig;
          const workflow = this.workflows.get(run.workflowId);
          if (!workflow) throw new Error('Workflow not found');

          const parallelSteps = config.stepIds
            .map(id => workflow.steps.find(s => s.id === id))
            .filter((s): s is WorkflowStep => s !== undefined);

          const results = await Promise.allSettled(
            parallelSteps.map(s => this.executeStep(s, run))
          );

          data = results.map((r, i) => ({
            stepId: parallelSteps[i].id,
            status: r.status === 'fulfilled' ? r.value.status : 'failed',
            data: r.status === 'fulfilled' ? r.value.data : undefined,
            error: r.status === 'rejected' ? String(r.reason) : undefined,
          }));
          break;
        }

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'completed',
        data,
        startedAt,
        completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
      };
    } catch (error) {
      const completedAt = new Date();
      return {
        stepId: step.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
      };
    }
  }

  private async executeConditionStep(step: WorkflowStep, run: WorkflowRun): Promise<void> {
    const config = step.config as ConditionStepConfig;

    try {
      const fn = new Function('variables', 'steps', `return (${config.expression})`);
      const result = fn(run.variables, Object.fromEntries(run.stepResults));

      const stepIds = result ? config.thenSteps : (config.elseSteps || []);
      const workflow = this.workflows.get(run.workflowId);
      if (!workflow) return;

      for (const stepId of stepIds) {
        const subStep = workflow.steps.find(s => s.id === stepId);
        if (subStep) {
          const subResult = await this.executeStep(subStep, run);
          run.stepResults.set(subStep.id, subResult);
          if (subResult.data !== undefined) {
            run.variables[`step_${subStep.id}`] = subResult.data;
          }
        }
      }

      run.stepResults.set(step.id, {
        stepId: step.id,
        status: 'completed',
        data: { condition: result, branch: result ? 'then' : 'else' },
        startedAt: new Date(),
        completedAt: new Date(),
      });
    } catch (error) {
      run.stepResults.set(step.id, {
        stepId: step.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        startedAt: new Date(),
        completedAt: new Date(),
      });
    }
  }

  private resolveVariables(params: Record<string, unknown>, variables: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const varName = value.slice(2, -2).trim();
        resolved[key] = variables[varName] ?? value;
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  get workflowCount(): number {
    return this.workflows.size;
  }
}

export function createWorkflowEngine(toolRegistry: ToolRegistry, auditLogger?: AuditLogger): WorkflowEngine {
  return new WorkflowEngine(toolRegistry, auditLogger);
}
