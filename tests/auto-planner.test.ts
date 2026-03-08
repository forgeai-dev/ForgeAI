import { describe, it, expect, beforeEach } from 'vitest';
import { AutoPlanner, createAutoPlanner } from '../packages/agent/src/auto-planner.js';

describe('AutoPlanner', () => {
  let planner: AutoPlanner;

  beforeEach(() => {
    planner = new AutoPlanner({ maxSteps: 10, maxRetries: 1 });
  });

  // ─── Create Plan ──────────────────────────────────────
  describe('createPlan', () => {
    it('should create a plan with steps', () => {
      const plan = planner.createPlan('Build a website', [
        { description: 'Create HTML structure' },
        { description: 'Add CSS styling' },
        { description: 'Add JavaScript interactivity' },
      ]);

      expect(plan.id).toContain('plan-');
      expect(plan.goal).toBe('Build a website');
      expect(plan.steps).toHaveLength(3);
      expect(plan.status).toBe('planning');
      expect(plan.totalSteps).toBe(3);
      expect(plan.completedSteps).toBe(0);
    });

    it('should assign step IDs and default types', () => {
      const plan = planner.createPlan('Test', [
        { description: 'Step 1' },
        { description: 'Step 2', type: 'decision' },
      ]);

      expect(plan.steps[0].id).toContain('step-0');
      expect(plan.steps[1].id).toContain('step-1');
      expect(plan.steps[0].type).toBe('action');
      expect(plan.steps[1].type).toBe('decision');
      expect(plan.steps[0].status).toBe('pending');
    });

    it('should respect maxSteps config', () => {
      const steps = Array.from({ length: 20 }, (_, i) => ({
        description: `Step ${i}`,
      }));

      const plan = planner.createPlan('Too many steps', steps);
      expect(plan.steps.length).toBeLessThanOrEqual(10);
    });

    it('should support dependencies', () => {
      const plan = planner.createPlan('Pipeline', [
        { description: 'First', dependencies: [] },
        { description: 'Second', dependencies: ['plan-1:step-0'] },
      ]);

      expect(plan.steps[1].dependencies).toContain('plan-1:step-0');
    });

    it('should support substeps for parallel execution', () => {
      const plan = planner.createPlan('Parallel', [
        {
          description: 'Parallel tasks',
          type: 'parallel',
          substeps: [
            { description: 'Sub A' },
            { description: 'Sub B' },
          ],
        },
      ]);

      expect(plan.steps[0].type).toBe('parallel');
      expect(plan.steps[0].substeps).toHaveLength(2);
      expect(plan.steps[0].substeps![0].description).toBe('Sub A');
    });

    it('should support tool specifications', () => {
      const plan = planner.createPlan('Automated', [
        { description: 'Create file', toolName: 'file_manager', toolArgs: { action: 'write', path: '/tmp/test.txt' } },
      ]);

      expect(plan.steps[0].toolName).toBe('file_manager');
      expect(plan.steps[0].toolArgs).toEqual({ action: 'write', path: '/tmp/test.txt' });
    });
  });

  // ─── Execute Plan ─────────────────────────────────────
  describe('executePlan', () => {
    it('should execute all steps sequentially', async () => {
      const executionOrder: string[] = [];
      const executor = async (toolName: string, _args: Record<string, unknown>) => {
        executionOrder.push(toolName);
        return { success: true };
      };

      const plan = planner.createPlan('Sequential', [
        { description: 'Step 1', toolName: 'tool_a' },
        { description: 'Step 2', toolName: 'tool_b' },
        { description: 'Step 3', toolName: 'tool_c' },
      ]);

      const result = await planner.executePlan(plan.id, executor);

      expect(result.status).toBe('completed');
      expect(result.completedSteps).toBe(3);
      expect(executionOrder).toEqual(['tool_a', 'tool_b', 'tool_c']);
      expect(result.completedAt).toBeDefined();
    });

    it('should mark informational steps as completed', async () => {
      const executor = async () => ({ success: true });

      const plan = planner.createPlan('Info', [
        { description: 'Just a note' }, // No toolName
      ]);

      const result = await planner.executePlan(plan.id, executor);
      expect(result.status).toBe('completed');
      expect(result.steps[0].status).toBe('completed');
    });

    it('should handle step failure with retry', async () => {
      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount === 1) throw new Error('Temporary failure');
        return { success: true };
      };

      const plan = planner.createPlan('Retry', [
        { description: 'Flaky step', toolName: 'flaky_tool' },
      ]);

      const result = await planner.executePlan(plan.id, executor);

      expect(result.status).toBe('completed');
      expect(callCount).toBe(2); // 1 fail + 1 retry
    });

    it('should fail plan when step fails after all retries', async () => {
      const executor = async () => {
        throw new Error('Permanent failure');
      };

      const plan = planner.createPlan('PermFail', [
        { description: 'Always fails', toolName: 'bad_tool' },
      ]);

      const result = await planner.executePlan(plan.id, executor);
      expect(result.status).toBe('failed');
    });

    it('should skip steps with unmet dependencies', async () => {
      const executor = async () => ({ success: true });

      const plan = planner.createPlan('DepSkip', [
        { description: 'Independent', toolName: 'tool_a' },
        { description: 'Depends on missing', toolName: 'tool_b', dependencies: ['nonexistent-id'] },
      ]);

      const result = await planner.executePlan(plan.id, executor);

      expect(result.steps[1].status).toBe('skipped');
    });

    it('should execute parallel substeps concurrently', async () => {
      const startTimes: Record<string, number> = {};
      const executor = async (toolName: string) => {
        startTimes[toolName] = Date.now();
        await new Promise(r => setTimeout(r, 30));
        return { success: true };
      };

      const plan = planner.createPlan('Parallel', [
        {
          description: 'Parallel batch',
          type: 'parallel',
          substeps: [
            { description: 'A', toolName: 'parallel_a' },
            { description: 'B', toolName: 'parallel_b' },
          ],
        },
      ]);

      const result = await planner.executePlan(plan.id, executor);

      expect(result.status).toBe('completed');
      // Both should start at roughly the same time
      const diff = Math.abs(startTimes['parallel_a'] - startTimes['parallel_b']);
      expect(diff).toBeLessThan(20);
    });

    it('should throw for non-existent plan', async () => {
      const executor = async () => ({ success: true });
      await expect(planner.executePlan('nonexistent', executor)).rejects.toThrow('not found');
    });

    it('should store step results', async () => {
      const executor = async () => ({ data: 'result-data' });

      const plan = planner.createPlan('Results', [
        { description: 'Has result', toolName: 'tool_a' },
      ]);

      const result = await planner.executePlan(plan.id, executor);
      expect(result.steps[0].result).toEqual({ data: 'result-data' });
    });

    it('should track step timing', async () => {
      const executor = async () => {
        await new Promise(r => setTimeout(r, 10));
        return { ok: true };
      };

      const plan = planner.createPlan('Timed', [
        { description: 'Timed step', toolName: 'tool_a' },
      ]);

      const result = await planner.executePlan(plan.id, executor);

      expect(result.steps[0].startedAt).toBeDefined();
      expect(result.steps[0].completedAt).toBeDefined();
      expect(result.steps[0].completedAt! - result.steps[0].startedAt!).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── Plan Management ──────────────────────────────────
  describe('Plan Management', () => {
    it('should get a plan by ID', () => {
      const plan = planner.createPlan('Get Test', [{ description: 'step' }]);
      const retrieved = planner.getPlan(plan.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.goal).toBe('Get Test');
    });

    it('should return undefined for non-existent plan', () => {
      expect(planner.getPlan('nonexistent')).toBeUndefined();
    });

    it('should list all plans', () => {
      planner.createPlan('Plan A', [{ description: 'step' }]);
      planner.createPlan('Plan B', [{ description: 'step' }]);

      const list = planner.listPlans();
      expect(list).toHaveLength(2);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('goal');
      expect(list[0]).toHaveProperty('status');
      expect(list[0]).toHaveProperty('steps');
    });

    it('should delete a plan', () => {
      const plan = planner.createPlan('Delete Me', [{ description: 'step' }]);
      expect(planner.deletePlan(plan.id)).toBe(true);
      expect(planner.getPlan(plan.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent plan', () => {
      expect(planner.deletePlan('nonexistent')).toBe(false);
    });

    it('should return config', () => {
      const config = planner.getConfig();
      expect(config.maxSteps).toBe(10);
      expect(config.maxRetries).toBe(1);
      expect(config.parallelExecution).toBe(true);
      expect(config.retryOnFailure).toBe(true);
    });
  });

  // ─── Config ───────────────────────────────────────────
  describe('Configuration', () => {
    it('should fail immediately when retryOnFailure is false', async () => {
      const noRetryPlanner = new AutoPlanner({ retryOnFailure: false });
      const executor = async () => { throw new Error('fail'); };

      const plan = noRetryPlanner.createPlan('NoRetry', [
        { description: 'Failing', toolName: 'bad' },
        { description: 'Never reached', toolName: 'good' },
      ]);

      const result = await noRetryPlanner.executePlan(plan.id, executor);
      expect(result.status).toBe('failed');
      expect(result.completedSteps).toBe(0);
    });
  });

  // ─── Factory ──────────────────────────────────────────
  describe('Factory', () => {
    it('should create planner via factory', () => {
      const p = createAutoPlanner({ maxSteps: 5 });
      expect(p).toBeInstanceOf(AutoPlanner);
      expect(p.getConfig().maxSteps).toBe(5);
    });

    it('should use defaults when no config provided', () => {
      const p = createAutoPlanner();
      expect(p.getConfig().maxSteps).toBe(20);
      expect(p.getConfig().maxDepth).toBe(3);
    });
  });
});
