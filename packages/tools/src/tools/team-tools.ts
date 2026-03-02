import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tool:ForgeTeam');

// ─── Types (mirrors forge-team.ts to avoid circular dep) ─

interface TeamTask {
  id: string;
  role: string;
  description: string;
  dependencies: string[];
}

interface TeamWorkerResult {
  taskId: string;
  role: string;
  status: string;
  result?: string;
  error?: string;
  duration?: number;
  steps?: number;
}

interface TeamResult {
  success: boolean;
  teamId: string;
  teamName: string;
  workers: TeamWorkerResult[];
  consolidatedResult: string;
  totalDuration: number;
  totalSteps: number;
  totalTokens: number;
  failedTasks: string[];
}

interface ActiveTeamInfo {
  id: string;
  name: string;
  status: string;
  workers: TeamWorkerResult[];
  createdAt: number;
  taskCount: number;
  completedCount: number;
  failedCount: number;
}

// Minimal interface for the team engine
interface ForgeTeamRef {
  executeTeam(params: {
    name: string;
    tasks: TeamTask[];
    parentSessionId: string;
  }): Promise<TeamResult>;
}

interface ActiveTeamsRef {
  getActiveTeams(): ActiveTeamInfo[];
}

// ─── Global Refs (set by gateway) ───────────────────────

let teamEngineRef: ForgeTeamRef | null = null;
let activeTeamsRef: ActiveTeamsRef | null = null;

export function setForgeTeamRef(engine: ForgeTeamRef, teamsStore: ActiveTeamsRef): void {
  teamEngineRef = engine;
  activeTeamsRef = teamsStore;
  logger.info('Forge Team engine ref set');
}

export function getActiveTeamsRef(): ActiveTeamsRef | null {
  return activeTeamsRef;
}

// ─── forge_team Tool ────────────────────────────────────

export class ForgeTeamTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'forge_team',
    description: `Create and execute a Forge Team — a coordinated group of specialist agents that work together on complex projects. Unlike agent_delegate (isolated workers), Forge Teams have:
- DEPENDENCY GRAPH: Task B can depend on Task A's output (B waits for A to finish, then receives A's results as context)
- PARALLEL EXECUTION: Independent tasks run simultaneously
- SHARED CONTEXT: Each worker receives outputs from their upstream dependencies
- TEAM COORDINATION: Workers build on each other's work for integrated results

Use forge_team for complex multi-part projects. Use agent_delegate for simple independent tasks.`,
    category: 'utility',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Team name (e.g., "Full-Stack App Team", "Research Team")',
        required: true,
      },
      {
        name: 'tasks',
        type: 'string',
        description: `JSON array of tasks. Each task: {"id":"unique_id", "role":"Specialist Role", "description":"Detailed task description with ALL necessary context", "dependencies":["id_of_upstream_task"]}
Example: [{"id":"design","role":"UI Designer","description":"Create dark theme landing page HTML...","dependencies":[]},{"id":"api","role":"Backend Engineer","description":"Create Flask REST API...","dependencies":[]},{"id":"integrate","role":"Integration Engineer","description":"Connect frontend to API...","dependencies":["design","api"]}]`,
        required: true,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();
    const name = params['name'] as string;
    const tasksRaw = params['tasks'] as string;
    const sessionId = params['_sessionId'] as string | undefined;

    if (!name || !tasksRaw) {
      return { success: false, error: 'name and tasks are required', duration: Date.now() - start };
    }

    if (!teamEngineRef) {
      return { success: false, error: 'Forge Teams not available (engine not connected)', duration: Date.now() - start };
    }

    // Parse tasks
    let tasks: TeamTask[];
    try {
      const parsed = typeof tasksRaw === 'string' ? JSON.parse(tasksRaw) : tasksRaw;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('tasks must be a non-empty array');
      }
      tasks = parsed.map((t: any, i: number) => ({
        id: t.id ?? `task-${i + 1}`,
        role: t.role ?? `Worker ${i + 1}`,
        description: t.description ?? '',
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
      }));
    } catch (e) {
      return {
        success: false,
        error: `Invalid tasks format: ${e instanceof Error ? e.message : 'must be a JSON array'}`,
        duration: Date.now() - start,
      };
    }

    // Validate each task has a description
    for (const task of tasks) {
      if (!task.description || task.description.trim().length < 10) {
        return {
          success: false,
          error: `Task "${task.id}" has insufficient description. Each task must have a detailed, self-contained description.`,
          duration: Date.now() - start,
        };
      }
    }

    logger.info(`Forge Team "${name}" requested`, {
      tasks: tasks.length,
      roles: tasks.map(t => t.role),
      dependencies: tasks.filter(t => t.dependencies.length > 0).length,
    });

    try {
      const result = await teamEngineRef.executeTeam({
        name,
        tasks,
        parentSessionId: sessionId ?? 'unknown',
      });

      if (!result.success) {
        return {
          success: false,
          error: `Team "${name}" had failures: ${result.failedTasks.join(', ')}`,
          data: {
            teamId: result.teamId,
            consolidatedResult: result.consolidatedResult,
            workers: result.workers.map(w => ({
              taskId: w.taskId,
              role: w.role,
              status: w.status,
              error: w.error,
              duration: w.duration,
            })),
            totalDuration: result.totalDuration,
            totalSteps: result.totalSteps,
          },
          duration: Date.now() - start,
        };
      }

      return {
        success: true,
        data: {
          teamId: result.teamId,
          teamName: result.teamName,
          consolidatedResult: result.consolidatedResult,
          workers: result.workers.map(w => ({
            taskId: w.taskId,
            role: w.role,
            status: w.status,
            duration: w.duration,
            steps: w.steps,
          })),
          totalDuration: result.totalDuration,
          totalSteps: result.totalSteps,
          totalTokens: result.totalTokens,
          message: `Forge Team "${name}" completed with ${result.workers.length} workers in ${Math.round(result.totalDuration / 1000)}s (${result.totalSteps} total steps).`,
        },
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: `Team execution failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
}
