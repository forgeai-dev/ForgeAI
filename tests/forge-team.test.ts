import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgeTeamEngine, createForgeTeamEngine, getActiveTeams, getActiveTeam } from '../packages/agent/src/forge-team.js';
import type { TeamTask } from '../packages/agent/src/forge-team.js';

// ─── Mock Delegate ────────────────────────────────────────
function createMockDelegate(opts: { failRoles?: string[]; delay?: number } = {}) {
  return {
    delegateTask: vi.fn(async (params: { role: string; task: string; context?: string; parentSessionId: string }) => {
      if (opts.delay) await new Promise(r => setTimeout(r, opts.delay));
      if (opts.failRoles?.includes(params.role)) {
        return {
          success: false,
          content: '',
          role: params.role,
          model: 'test-model',
          duration: 100,
          steps: 1,
          tokens: 50,
          error: `${params.role} failed`,
        };
      }
      return {
        success: true,
        content: `Result from ${params.role}: completed "${params.task.substring(0, 50)}"`,
        role: params.role,
        model: 'test-model',
        duration: 200,
        steps: 3,
        tokens: 150,
      };
    }),
  };
}

describe('ForgeTeamEngine', () => {
  let engine: ForgeTeamEngine;
  let mockDelegate: ReturnType<typeof createMockDelegate>;

  beforeEach(() => {
    mockDelegate = createMockDelegate();
    engine = new ForgeTeamEngine(mockDelegate);
  });

  // ─── Basic Execution ──────────────────────────────────
  describe('Basic Execution', () => {
    it('should execute a simple team with no dependencies', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Designer', description: 'Create UI mockups for the dashboard', dependencies: [] },
        { id: 'b', role: 'Backend Dev', description: 'Build the REST API endpoints', dependencies: [] },
      ];

      const result = await engine.executeTeam({ name: 'Test Team', tasks, parentSessionId: 'sess-1' });

      expect(result.success).toBe(true);
      expect(result.teamName).toBe('Test Team');
      expect(result.workers).toHaveLength(2);
      expect(result.workers.every(w => w.status === 'completed')).toBe(true);
      expect(result.totalSteps).toBe(6); // 3 steps per worker
      expect(result.totalTokens).toBe(300); // 150 per worker
      expect(result.failedTasks).toHaveLength(0);
      expect(mockDelegate.delegateTask).toHaveBeenCalledTimes(2);
    });

    it('should pass parentSessionId to delegate', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker', description: 'Do something useful here', dependencies: [] },
      ];

      await engine.executeTeam({ name: 'Test', tasks, parentSessionId: 'my-session' });

      expect(mockDelegate.delegateTask).toHaveBeenCalledWith(
        expect.objectContaining({ parentSessionId: 'my-session' }),
      );
    });
  });

  // ─── Dependency Graph ─────────────────────────────────
  describe('Dependency Graph', () => {
    it('should execute dependent tasks in order', async () => {
      const callOrder: string[] = [];
      const orderedDelegate = {
        delegateTask: vi.fn(async (params: { role: string; task: string; context?: string; parentSessionId: string }) => {
          callOrder.push(params.role);
          return {
            success: true,
            content: `Done: ${params.role}`,
            role: params.role,
            model: 'test-model',
            duration: 100,
            steps: 1,
            tokens: 50,
          };
        }),
      };

      const eng = new ForgeTeamEngine(orderedDelegate);
      const tasks: TeamTask[] = [
        { id: 'a', role: 'First', description: 'Step one of the pipeline', dependencies: [] },
        { id: 'b', role: 'Second', description: 'Step two depends on first', dependencies: ['a'] },
      ];

      const result = await eng.executeTeam({ name: 'Ordered', tasks, parentSessionId: 's1' });

      expect(result.success).toBe(true);
      expect(callOrder.indexOf('First')).toBeLessThan(callOrder.indexOf('Second'));
    });

    it('should pass upstream context to dependent tasks', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Researcher', description: 'Research the topic thoroughly', dependencies: [] },
        { id: 'b', role: 'Writer', description: 'Write based on research data', dependencies: ['a'] },
      ];

      await engine.executeTeam({ name: 'Pipeline', tasks, parentSessionId: 's1' });

      // Second call should have context from first
      const writerCall = mockDelegate.delegateTask.mock.calls.find(
        (c: any[]) => c[0].role === 'Writer',
      );
      expect(writerCall).toBeDefined();
      expect(writerCall![0].context).toContain('Researcher');
      expect(writerCall![0].context).toContain('Forge Team');
    });

    it('should run independent tasks in parallel', async () => {
      const startTimes: Record<string, number> = {};
      const parallelDelegate = {
        delegateTask: vi.fn(async (params: { role: string; task: string; context?: string; parentSessionId: string }) => {
          startTimes[params.role] = Date.now();
          await new Promise(r => setTimeout(r, 50));
          return {
            success: true,
            content: `Done: ${params.role}`,
            role: params.role,
            model: 'test-model',
            duration: 50,
            steps: 1,
            tokens: 50,
          };
        }),
      };

      const eng = new ForgeTeamEngine(parallelDelegate);
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker A', description: 'Independent task A description', dependencies: [] },
        { id: 'b', role: 'Worker B', description: 'Independent task B description', dependencies: [] },
      ];

      await eng.executeTeam({ name: 'Parallel', tasks, parentSessionId: 's1' });

      // Both should start at roughly the same time (within 30ms)
      const diff = Math.abs(startTimes['Worker A'] - startTimes['Worker B']);
      expect(diff).toBeLessThan(30);
    });
  });

  // ─── Validation ─────────────────────────────────────────
  describe('Validation', () => {
    it('should fail with no tasks', async () => {
      const result = await engine.executeTeam({ name: 'Empty', tasks: [], parentSessionId: 's1' });
      expect(result.success).toBe(false);
      expect(result.consolidatedResult).toContain('No tasks provided');
    });

    it('should fail with too many tasks (>5)', async () => {
      const tasks: TeamTask[] = Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`, role: `Worker ${i}`, description: `Task description number ${i}`, dependencies: [],
      }));
      const result = await engine.executeTeam({ name: 'TooMany', tasks, parentSessionId: 's1' });
      expect(result.success).toBe(false);
      expect(result.consolidatedResult).toContain('Max 5');
    });

    it('should fail on self-dependency', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker', description: 'Self dependent task here', dependencies: ['a'] },
      ];
      const result = await engine.executeTeam({ name: 'SelfDep', tasks, parentSessionId: 's1' });
      expect(result.success).toBe(false);
      expect(result.consolidatedResult).toContain('depends on itself');
    });

    it('should fail on unknown dependency', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker', description: 'Depends on nonexistent task', dependencies: ['z'] },
      ];
      const result = await engine.executeTeam({ name: 'UnknownDep', tasks, parentSessionId: 's1' });
      expect(result.success).toBe(false);
      expect(result.consolidatedResult).toContain('unknown task');
    });

    it('should fail on dependency cycle', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker A', description: 'Circular dep task A description', dependencies: ['b'] },
        { id: 'b', role: 'Worker B', description: 'Circular dep task B description', dependencies: ['a'] },
      ];
      const result = await engine.executeTeam({ name: 'Cycle', tasks, parentSessionId: 's1' });
      expect(result.success).toBe(false);
      expect(result.consolidatedResult).toContain('cycle');
    });
  });

  // ─── Failure Handling ───────────────────────────────────
  describe('Failure Handling', () => {
    it('should handle worker failure', async () => {
      const failDelegate = createMockDelegate({ failRoles: ['Failing Worker'] });
      const eng = new ForgeTeamEngine(failDelegate);

      const tasks: TeamTask[] = [
        { id: 'a', role: 'Failing Worker', description: 'This worker will fail hard', dependencies: [] },
        { id: 'b', role: 'Good Worker', description: 'This worker will succeed ok', dependencies: [] },
      ];

      const result = await eng.executeTeam({ name: 'Mixed', tasks, parentSessionId: 's1' });

      expect(result.success).toBe(false);
      expect(result.failedTasks).toHaveLength(1);
      expect(result.workers.find(w => w.role === 'Failing Worker')!.status).toBe('failed');
      expect(result.workers.find(w => w.role === 'Good Worker')!.status).toBe('completed');
    });

    it('should block downstream tasks when upstream fails', async () => {
      const failDelegate = createMockDelegate({ failRoles: ['First'] });
      const eng = new ForgeTeamEngine(failDelegate);

      const tasks: TeamTask[] = [
        { id: 'a', role: 'First', description: 'Upstream task that will fail', dependencies: [] },
        { id: 'b', role: 'Second', description: 'Downstream task blocked by first', dependencies: ['a'] },
      ];

      const result = await eng.executeTeam({ name: 'Blocked', tasks, parentSessionId: 's1' });

      expect(result.success).toBe(false);
      expect(result.workers.find(w => w.role === 'Second')!.status).toBe('failed');
      expect(result.workers.find(w => w.role === 'Second')!.error).toContain('Blocked');
    });
  });

  // ─── Active Teams Tracking ────────────────────────────
  describe('Active Teams', () => {
    it('should track active teams during execution', async () => {
      const slowDelegate = createMockDelegate({ delay: 100 });
      const eng = new ForgeTeamEngine(slowDelegate);

      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker', description: 'Slow task that takes time', dependencies: [] },
      ];

      const promise = eng.executeTeam({ name: 'Tracked', tasks, parentSessionId: 's1' });

      // While running, team should be active
      await new Promise(r => setTimeout(r, 30));
      const active = getActiveTeams();
      expect(active.some(t => t.name === 'Tracked')).toBe(true);

      await promise;
    });
  });

  // ─── Factory ──────────────────────────────────────────
  describe('Factory', () => {
    it('should create engine via factory', () => {
      const eng = createForgeTeamEngine(mockDelegate);
      expect(eng).toBeInstanceOf(ForgeTeamEngine);
    });
  });

  // ─── Result Structure ─────────────────────────────────
  describe('Result Structure', () => {
    it('should include consolidated result with worker details', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Analyst', description: 'Analyze the given data set', dependencies: [] },
      ];

      const result = await engine.executeTeam({ name: 'Detailed', tasks, parentSessionId: 's1' });

      expect(result.consolidatedResult).toContain('Forge Team "Detailed"');
      expect(result.consolidatedResult).toContain('Analyst');
      expect(result.consolidatedResult).toContain('✅');
      expect(result.teamId).toContain('team-');
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should track worker duration and model', async () => {
      const tasks: TeamTask[] = [
        { id: 'a', role: 'Worker', description: 'Track timing of this task', dependencies: [] },
      ];

      const result = await engine.executeTeam({ name: 'Timed', tasks, parentSessionId: 's1' });

      const worker = result.workers[0];
      expect(worker.model).toBe('test-model');
      expect(worker.steps).toBe(3);
      expect(worker.tokens).toBe(150);
      expect(worker.duration).toBeDefined();
      expect(worker.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
