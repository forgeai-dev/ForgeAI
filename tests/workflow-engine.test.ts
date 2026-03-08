import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentWorkflowEngine,
  createAgentWorkflowEngine,
  InMemoryWorkflowStore,
} from '../packages/agent/src/workflow-engine.js';
import type { ExtractedContext } from '../packages/agent/src/workflow-engine.js';

describe('AgentWorkflowEngine', () => {
  let engine: AgentWorkflowEngine;

  beforeEach(() => {
    engine = new AgentWorkflowEngine(new InMemoryWorkflowStore());
  });

  // ─── Create Workflow ──────────────────────────────────
  describe('createWorkflow', () => {
    it('should create a workflow with steps', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'Build a React app',
        steps: [
          { title: 'Setup', description: 'Init project', objective: 'Create project scaffold' },
          { title: 'Build', description: 'Build components', objective: 'Create React components' },
        ],
      });

      expect(wf.id).toContain('wf');
      expect(wf.sessionId).toBe('sess-1');
      expect(wf.agentId).toBe('agent-1');
      expect(wf.steps).toHaveLength(2);
      expect(wf.status).toBe('executing');
      expect(wf.currentStepIndex).toBe(0);
      expect(wf.totalTokens).toBe(0);
      expect(wf.errorCount).toBe(0);
    });

    it('should create workflow in planning state when no steps provided', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'Complex task',
      });

      expect(wf.status).toBe('planning');
      expect(wf.steps).toHaveLength(0);
    });

    it('should generate unique IDs for steps', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'A', description: 'desc', objective: 'obj' },
          { title: 'B', description: 'desc', objective: 'obj' },
        ],
      });

      expect(wf.steps[0].id).not.toBe(wf.steps[1].id);
      expect(wf.steps[0].index).toBe(0);
      expect(wf.steps[1].index).toBe(1);
      expect(wf.steps[0].status).toBe('pending');
      expect(wf.steps[0].retryCount).toBe(0);
      expect(wf.steps[0].maxRetries).toBe(2);
    });
  });

  // ─── Get Active Workflow ──────────────────────────────
  describe('getActiveWorkflow', () => {
    it('should return active workflow for session', async () => {
      await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      const active = await engine.getActiveWorkflow('sess-1');
      expect(active).not.toBeNull();
      expect(active!.sessionId).toBe('sess-1');
    });

    it('should return null for session with no workflow', async () => {
      const active = await engine.getActiveWorkflow('nonexistent');
      expect(active).toBeNull();
    });

    it('should not return completed workflows', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      // Complete the only step
      await engine.advanceStep(wf.id, { output: 'done' });

      const active = await engine.getActiveWorkflow('sess-1');
      expect(active).toBeNull();
    });
  });

  // ─── Advance Step ─────────────────────────────────────
  describe('advanceStep', () => {
    it('should advance to next step on success', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'Step 1', description: 'd1', objective: 'o1' },
          { title: 'Step 2', description: 'd2', objective: 'o2' },
        ],
      });

      const updated = await engine.advanceStep(wf.id, { output: 'Step 1 done', tokenCost: 100 });

      expect(updated).not.toBeNull();
      expect(updated!.currentStepIndex).toBe(1);
      expect(updated!.steps[0].status).toBe('completed');
      expect(updated!.steps[0].actualOutput).toBe('Step 1 done');
      expect(updated!.steps[0].tokenCost).toBe(100);
      expect(updated!.totalTokens).toBe(100);
    });

    it('should complete workflow when all steps done', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'Only Step', description: 'd', objective: 'o' }],
      });

      const updated = await engine.advanceStep(wf.id, { output: 'done' });

      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeDefined();
    });

    it('should handle step failure with retry', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'Flaky Step', description: 'd', objective: 'o' },
          { title: 'Step 2', description: 'd', objective: 'o' },
        ],
      });

      // First failure — should retry (retryCount < maxRetries)
      const updated = await engine.advanceStep(wf.id, { error: 'timeout' });

      expect(updated).not.toBeNull();
      expect(updated!.errorCount).toBe(1);
      // Step should be reset to pending for retry
      expect(updated!.steps[0].retryCount).toBe(1);
      expect(updated!.steps[0].status).toBe('pending');
      expect(updated!.currentStepIndex).toBe(0); // Still on same step
    });

    it('should skip step after max retries', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'Failing Step', description: 'd', objective: 'o' },
          { title: 'Next Step', description: 'd', objective: 'o' },
        ],
      });

      // Fail 3 times (maxRetries is 2, so 3rd time should move on)
      await engine.advanceStep(wf.id, { error: 'fail 1' });
      await engine.advanceStep(wf.id, { error: 'fail 2' });
      const updated = await engine.advanceStep(wf.id, { error: 'fail 3' });

      expect(updated!.currentStepIndex).toBe(1); // Moved past failing step
      expect(updated!.steps[0].status).toBe('failed');
    });

    it('should return null for non-existent workflow', async () => {
      const result = await engine.advanceStep('nonexistent');
      expect(result).toBeNull();
    });

    it('should truncate actualOutput to 2000 chars', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      const longOutput = 'x'.repeat(3000);
      const updated = await engine.advanceStep(wf.id, { output: longOutput });

      expect(updated!.steps[0].actualOutput!.length).toBeLessThanOrEqual(2000);
    });
  });

  // ─── Set Context ──────────────────────────────────────
  describe('setContext', () => {
    it('should set extracted context on workflow', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
      });

      const ctx: ExtractedContext = {
        taskType: 'web_app',
        entities: ['React', 'TypeScript'],
        constraints: ['mobile-first'],
        language: 'en',
        complexity: 'high',
        summary: 'Build a React web app',
      };

      const updated = await engine.setContext(wf.id, ctx);

      expect(updated).not.toBeNull();
      expect(updated!.context).toEqual(ctx);
      expect(updated!.status).toBe('planning'); // No steps yet
    });
  });

  // ─── Set Steps ────────────────────────────────────────
  describe('setSteps', () => {
    it('should set steps after planning phase', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
      });

      const updated = await engine.setSteps(wf.id, [
        { title: 'Init', description: 'Initialize', objective: 'Setup' },
        { title: 'Build', description: 'Build it', objective: 'Create' },
      ]);

      expect(updated).not.toBeNull();
      expect(updated!.steps).toHaveLength(2);
      expect(updated!.status).toBe('executing');
      expect(updated!.currentStepIndex).toBe(0);
    });
  });

  // ─── Cancel Workflow ──────────────────────────────────
  describe('cancelWorkflow', () => {
    it('should cancel a workflow', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      await engine.cancelWorkflow(wf.id);

      const active = await engine.getActiveWorkflow('sess-1');
      expect(active).toBeNull(); // Cancelled = not active
    });
  });

  // ─── Build Workflow Context ───────────────────────────
  describe('buildWorkflowContext', () => {
    it('should build context string with step details', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'Init', description: 'Initialize project', objective: 'Setup' },
          { title: 'Build', description: 'Build components', objective: 'Create' },
        ],
        context: {
          taskType: 'web_app',
          entities: ['React'],
          constraints: ['fast'],
          language: 'en',
          complexity: 'medium',
          summary: 'Build a web app',
        },
      });

      const ctx = engine.buildWorkflowContext(wf);

      expect(ctx).toContain('Active Workflow');
      expect(ctx).toContain('Step 1/2');
      expect(ctx).toContain('Init');
      expect(ctx).toContain('Build');
      expect(ctx).toContain('CURRENT OBJECTIVE');
      expect(ctx).toContain('Build a web app');
      expect(ctx).toContain('React');
    });
  });

  // ─── Get Current Step Objective ───────────────────────
  describe('getCurrentStepObjective', () => {
    it('should return objective for current step', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [
          { title: 'Init', description: 'Initialize the project', objective: 'Setup scaffold' },
        ],
      });

      const obj = engine.getCurrentStepObjective(wf);
      expect(obj).toContain('Init');
      expect(obj).toContain('Setup scaffold');
      expect(obj).toContain('Step 1/1');
    });

    it('should return null when no steps', async () => {
      const wf = await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
      });

      const obj = engine.getCurrentStepObjective(wf);
      expect(obj).toBeNull();
    });
  });

  // ─── List Active ──────────────────────────────────────
  describe('listActive', () => {
    it('should list active workflows', async () => {
      await engine.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'task 1',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });
      await engine.createWorkflow({
        sessionId: 'sess-2',
        agentId: 'agent-1',
        userMessage: 'task 2',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      const active = await engine.listActive();
      expect(active).toHaveLength(2);
    });
  });

  // ─── InMemoryWorkflowStore ────────────────────────────
  describe('InMemoryWorkflowStore', () => {
    it('should save and load workflow', async () => {
      const store = new InMemoryWorkflowStore();
      const eng = new AgentWorkflowEngine(store);

      const wf = await eng.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      // Should be deep-cloned (not same reference)
      const loaded = await store.load(wf.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(wf.id);
      expect(loaded).not.toBe(wf); // Different object reference
    });

    it('should delete workflow', async () => {
      const store = new InMemoryWorkflowStore();
      const eng = new AgentWorkflowEngine(store);

      const wf = await eng.createWorkflow({
        sessionId: 'sess-1',
        agentId: 'agent-1',
        userMessage: 'test',
        steps: [{ title: 'S', description: 'd', objective: 'o' }],
      });

      await store.delete(wf.id);
      const loaded = await store.load(wf.id);
      expect(loaded).toBeNull();
    });
  });

  // ─── Factory ──────────────────────────────────────────
  describe('Factory', () => {
    it('should create engine via factory', () => {
      const eng = createAgentWorkflowEngine();
      expect(eng).toBeInstanceOf(AgentWorkflowEngine);
    });

    it('should create engine with custom persistence', () => {
      const store = new InMemoryWorkflowStore();
      const eng = createAgentWorkflowEngine(store);
      expect(eng).toBeInstanceOf(AgentWorkflowEngine);
    });
  });
});
