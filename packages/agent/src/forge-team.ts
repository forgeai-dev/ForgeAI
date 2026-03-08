import { createLogger, generateId } from '@forgeai/shared';

const logger = createLogger('Agent:ForgeTeam');

// ─── Types ──────────────────────────────────────────────

export interface TeamTask {
  id: string;
  role: string;
  description: string;
  dependencies: string[];
}

export interface TeamWorker {
  taskId: string;
  role: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  steps?: number;
  model?: string;
  tokens?: number;
}

export interface ActiveTeam {
  id: string;
  name: string;
  status: 'planning' | 'running' | 'completed' | 'failed';
  workers: TeamWorker[];
  createdAt: number;
  completedAt?: number;
  totalDuration?: number;
  parentSessionId: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
}

export interface TeamResult {
  success: boolean;
  teamId: string;
  teamName: string;
  workers: TeamWorker[];
  consolidatedResult: string;
  totalDuration: number;
  totalSteps: number;
  totalTokens: number;
  failedTasks: string[];
}

// Minimal interface to avoid circular dependency
interface TeamDelegateRef {
  delegateTask(params: {
    role: string;
    task: string;
    context?: string;
    parentSessionId: string;
  }): Promise<{
    success: boolean;
    content: string;
    role: string;
    model: string;
    duration: number;
    steps: number;
    tokens?: number;
    error?: string;
  }>;
}

// ─── Constants ──────────────────────────────────────────

const MAX_WORKERS_PER_TEAM = 5;
const MAX_CONCURRENT_TEAMS = 2;
const WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per worker
const TEAM_CLEANUP_MS = 10 * 60 * 1000;  // Cleanup after 10 minutes

// ─── Active Teams Store (global) ────────────────────────

const activeTeams: Map<string, ActiveTeam> = new Map();

export function getActiveTeams(): ActiveTeam[] {
  return Array.from(activeTeams.values());
}

export function getActiveTeam(teamId: string): ActiveTeam | undefined {
  return activeTeams.get(teamId);
}

// ─── Forge Team Engine ──────────────────────────────────

export class ForgeTeamEngine {
  private delegateRef: TeamDelegateRef;

  constructor(delegateRef: TeamDelegateRef) {
    this.delegateRef = delegateRef;
  }

  /**
   * Execute a team of workers with dependency-aware orchestration.
   * Independent tasks run in parallel; dependent tasks wait for upstream results.
   */
  async executeTeam(params: {
    name: string;
    tasks: TeamTask[];
    parentSessionId: string;
  }): Promise<TeamResult> {
    const startTime = Date.now();
    const teamId = `team-${generateId('t')}`;

    // Validate
    if (params.tasks.length === 0) {
      return this.failResult(teamId, params.name, 'No tasks provided');
    }
    if (params.tasks.length > MAX_WORKERS_PER_TEAM) {
      return this.failResult(teamId, params.name, `Max ${MAX_WORKERS_PER_TEAM} workers per team`);
    }
    const runningCount = Array.from(activeTeams.values()).filter(
      t => t.status === 'running' || t.status === 'planning',
    ).length;
    if (runningCount >= MAX_CONCURRENT_TEAMS) {
      return this.failResult(teamId, params.name, `Max ${MAX_CONCURRENT_TEAMS} concurrent teams. Wait for current teams to finish.`);
    }

    // Validate dependency graph (no cycles, all refs valid)
    const validationError = this.validateDependencyGraph(params.tasks);
    if (validationError) {
      return this.failResult(teamId, params.name, validationError);
    }

    // Initialize workers
    const workers: TeamWorker[] = params.tasks.map(t => ({
      taskId: t.id,
      role: t.role,
      status: 'waiting' as const,
    }));

    // Register active team
    const team: ActiveTeam = {
      id: teamId,
      name: params.name,
      status: 'running',
      workers,
      createdAt: startTime,
      parentSessionId: params.parentSessionId,
      taskCount: params.tasks.length,
      completedCount: 0,
      failedCount: 0,
    };
    activeTeams.set(teamId, team);

    logger.info(`Forge Team "${params.name}" started`, {
      teamId,
      workers: params.tasks.length,
      tasks: params.tasks.map(t => `${t.id}:${t.role}`),
    });

    // Build task map and results store
    const taskMap = new Map(params.tasks.map(t => [t.id, t]));
    const taskResults = new Map<string, string>();

    try {
      // Execute using topological ordering with parallel execution of independent tasks
      await this.executeWithDependencies(
        params.tasks,
        taskMap,
        taskResults,
        workers,
        team,
        params.parentSessionId,
      );

      // Consolidate results
      const completedWorkers = workers.filter(w => w.status === 'completed');
      const failedWorkers = workers.filter(w => w.status === 'failed');
      const totalDuration = Date.now() - startTime;

      team.status = failedWorkers.length > 0 ? 'failed' : 'completed';
      team.completedAt = Date.now();
      team.totalDuration = totalDuration;

      // Build consolidated result
      const consolidatedParts: string[] = [];
      consolidatedParts.push(`# Forge Team "${params.name}" — Results\n`);

      for (const worker of workers) {
        const icon = worker.status === 'completed' ? '✅' : '❌';
        consolidatedParts.push(`## ${icon} ${worker.role} (${worker.taskId})`);
        if (worker.result) {
          consolidatedParts.push(worker.result);
        } else if (worker.error) {
          consolidatedParts.push(`Error: ${worker.error}`);
        }
        consolidatedParts.push('');
      }

      const result: TeamResult = {
        success: failedWorkers.length === 0,
        teamId,
        teamName: params.name,
        workers,
        consolidatedResult: consolidatedParts.join('\n'),
        totalDuration,
        totalSteps: workers.reduce((sum, w) => sum + (w.steps ?? 0), 0),
        totalTokens: workers.reduce((sum, w) => sum + (w.tokens ?? 0), 0),
        failedTasks: failedWorkers.map(w => `${w.taskId}:${w.role}`),
      };

      logger.info(`Forge Team "${params.name}" ${team.status}`, {
        teamId,
        duration: totalDuration,
        completed: completedWorkers.length,
        failed: failedWorkers.length,
        totalSteps: result.totalSteps,
      });

      // Schedule cleanup
      setTimeout(() => {
        activeTeams.delete(teamId);
        logger.debug(`Team ${teamId} cleaned up`);
      }, TEAM_CLEANUP_MS);

      return result;

    } catch (error) {
      team.status = 'failed';
      team.completedAt = Date.now();
      team.totalDuration = Date.now() - startTime;

      logger.error(`Forge Team "${params.name}" crashed`, { teamId, error });

      setTimeout(() => activeTeams.delete(teamId), TEAM_CLEANUP_MS);

      return this.failResult(teamId, params.name,
        error instanceof Error ? error.message : String(error),
        workers, Date.now() - startTime);
    }
  }

  // ─── Dependency-Aware Execution ───────────────────────

  private async executeWithDependencies(
    tasks: TeamTask[],
    taskMap: Map<string, TeamTask>,
    taskResults: Map<string, string>,
    workers: TeamWorker[],
    team: ActiveTeam,
    parentSessionId: string,
  ): Promise<void> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const running = new Set<string>();

    const getWorker = (taskId: string) => workers.find(w => w.taskId === taskId)!;

    // Find tasks ready to run (all dependencies met)
    const getReadyTasks = (): TeamTask[] => {
      return tasks.filter(t =>
        !completed.has(t.id) &&
        !failed.has(t.id) &&
        !running.has(t.id) &&
        t.dependencies.every(dep => completed.has(dep))
      );
    };

    while (completed.size + failed.size < tasks.length) {
      const ready = getReadyTasks();

      if (ready.length === 0 && running.size === 0) {
        // Deadlock — remaining tasks have unmet dependencies from failed tasks
        const blocked = tasks.filter(t => !completed.has(t.id) && !failed.has(t.id));
        for (const t of blocked) {
          const worker = getWorker(t.id);
          worker.status = 'failed';
          worker.error = 'Blocked: upstream dependency failed';
          failed.add(t.id);
          team.failedCount++;
        }
        break;
      }

      if (ready.length > 0) {
        // Launch all ready tasks in parallel
        const promises = ready.map(async (task) => {
          running.add(task.id);
          const worker = getWorker(task.id);
          worker.status = 'running';
          worker.startedAt = Date.now();

          logger.info(`Worker "${task.role}" starting`, { taskId: task.id, teamId: team.id });

          // Build context from upstream dependencies
          const upstreamContext = task.dependencies
            .filter(dep => taskResults.has(dep))
            .map(dep => {
              const depTask = taskMap.get(dep)!;
              return `--- Output from ${depTask.role} (${dep}) ---\n${taskResults.get(dep)}`;
            })
            .join('\n\n');

          const fullContext = upstreamContext
            ? `You are part of Forge Team "${team.name}". Your teammates have completed work that you should build upon.\n\n${upstreamContext}`
            : `You are part of Forge Team "${team.name}". You are working on an independent task.`;

          try {
            // Execute with timeout
            const result = await Promise.race([
              this.delegateRef.delegateTask({
                role: task.role,
                task: task.description,
                context: fullContext,
                parentSessionId,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Worker timeout (5min)')), WORKER_TIMEOUT_MS)
              ),
            ]);

            worker.completedAt = Date.now();
            worker.duration = worker.completedAt - worker.startedAt;
            worker.model = result.model;
            worker.steps = result.steps;
            worker.tokens = result.tokens;

            if (result.success) {
              worker.status = 'completed';
              worker.result = result.content;
              taskResults.set(task.id, result.content);
              completed.add(task.id);
              team.completedCount++;
              logger.info(`Worker "${task.role}" completed`, {
                taskId: task.id,
                duration: worker.duration,
                steps: worker.steps,
              });
            } else {
              worker.status = 'failed';
              worker.error = result.error ?? 'Unknown error';
              failed.add(task.id);
              team.failedCount++;
              logger.warn(`Worker "${task.role}" failed`, { taskId: task.id, error: worker.error });
            }
          } catch (error) {
            worker.status = 'failed';
            worker.error = error instanceof Error ? error.message : String(error);
            worker.completedAt = Date.now();
            worker.duration = worker.completedAt - (worker.startedAt ?? Date.now());
            failed.add(task.id);
            team.failedCount++;
            logger.error(`Worker "${task.role}" crashed`, { taskId: task.id, error: worker.error });
          } finally {
            running.delete(task.id);
          }
        });

        // Wait for this batch of parallel tasks
        await Promise.allSettled(promises);
      } else {
        // Tasks are running, wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // ─── Validation ───────────────────────────────────────

  private validateDependencyGraph(tasks: TeamTask[]): string | null {
    const ids = new Set(tasks.map(t => t.id));

    // Check all dependency references are valid
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (!ids.has(dep)) {
          return `Task "${task.id}" depends on unknown task "${dep}"`;
        }
        if (dep === task.id) {
          return `Task "${task.id}" depends on itself`;
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const task = taskMap.get(id)!;
      for (const dep of task.dependencies) {
        if (hasCycle(dep)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    for (const task of tasks) {
      if (hasCycle(task.id)) {
        return 'Dependency cycle detected in task graph';
      }
    }

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────

  private failResult(
    teamId: string,
    teamName: string,
    error: string,
    workers: TeamWorker[] = [],
    duration = 0,
  ): TeamResult {
    return {
      success: false,
      teamId,
      teamName,
      workers,
      consolidatedResult: `Team "${teamName}" failed: ${error}`,
      totalDuration: duration,
      totalSteps: 0,
      totalTokens: 0,
      failedTasks: [error],
    };
  }
}

export function createForgeTeamEngine(delegateRef: TeamDelegateRef): ForgeTeamEngine {
  return new ForgeTeamEngine(delegateRef);
}
