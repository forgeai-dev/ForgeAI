import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tool:Plan');

// ─── Types ──────────────────────────────────────────────

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

export interface ActivePlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: 'active' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

// ─── Global Plan Store (per-session) ────────────────────

const sessionPlans: Map<string, ActivePlan> = new Map();
let planCounter = 0;

/**
 * Get the active plan for a session.
 */
export function getSessionPlan(sessionId: string): ActivePlan | null {
  const plan = sessionPlans.get(sessionId);
  if (!plan || plan.status !== 'active') return null;
  return plan;
}

/**
 * Get any plan for a session (including completed/failed).
 */
export function getSessionPlanAny(sessionId: string): ActivePlan | null {
  return sessionPlans.get(sessionId) ?? null;
}

/**
 * Clear the plan for a session.
 */
export function clearSessionPlan(sessionId: string): void {
  sessionPlans.delete(sessionId);
}

/**
 * Build a formatted plan context string for injection into LLM messages.
 * Returns null if no active plan exists.
 */
export function buildPlanContext(sessionId: string): string | null {
  const plan = sessionPlans.get(sessionId);
  if (!plan || plan.status !== 'active') return null;

  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;
  const lines: string[] = [];

  lines.push(`ACTIVE PLAN: ${plan.goal}`);
  lines.push(`Progress: ${completed}/${total} steps`);
  lines.push('');

  for (const step of plan.steps) {
    const icon = step.status === 'completed' ? '✓'
      : step.status === 'in_progress' ? '→'
      : step.status === 'failed' ? '✗'
      : step.status === 'skipped' ? '⊘'
      : '○';
    const suffix = step.status === 'in_progress' ? ' ← CURRENT' : '';
    const resultNote = step.result ? ` (${step.result})` : '';
    lines.push(`  [${icon}] Step ${step.id}: ${step.description}${suffix}${resultNote}`);
  }

  lines.push('');
  lines.push('Execute the CURRENT step (→), then call plan_update to mark it done before moving on.');

  return lines.join('\n');
}

/**
 * Get plan stats across all sessions.
 */
export function getPlanStats(): { activePlans: number; totalPlans: number; sessions: string[] } {
  const active = Array.from(sessionPlans.values()).filter(p => p.status === 'active').length;
  return {
    activePlans: active,
    totalPlans: sessionPlans.size,
    sessions: Array.from(sessionPlans.keys()),
  };
}

// ─── plan_create Tool ───────────────────────────────────

export class PlanCreateTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'plan_create',
    description: 'Create an execution plan for a complex multi-step task. Use this BEFORE starting tasks that require 3 or more steps. Helps track progress, prevents losing context, and ensures systematic execution. The plan is displayed to the user in real-time.',
    category: 'utility',
    parameters: [
      {
        name: 'goal',
        type: 'string',
        description: 'The overall goal (what the user asked for)',
        required: true,
      },
      {
        name: 'steps',
        type: 'string',
        description: 'JSON array of step descriptions. Each step should be a clear, actionable item. Example: ["Research competitors", "Create HTML structure", "Add CSS styling", "Deploy and verify"]',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();
    const goal = params['goal'] as string;
    const stepsRaw = params['steps'] as string;
    const sessionId = params['_sessionId'] as string | undefined;

    if (!goal || !stepsRaw) {
      return { success: false, error: 'goal and steps are required', duration: Date.now() - start };
    }

    let stepDescriptions: string[];
    try {
      // Handle multiple input formats from LLMs:
      // 1. Already an array (if runtime passed parsed JSON)
      // 2. JSON string: '["step1", "step2"]'
      // 3. Comma-separated: "step1, step2, step3"
      // 4. Newline-separated: "step1\nstep2\nstep3"
      if (Array.isArray(stepsRaw)) {
        stepDescriptions = (stepsRaw as unknown as string[]).map(s => String(s).trim()).filter(Boolean);
      } else if (typeof stepsRaw === 'string') {
        const trimmed = stepsRaw.trim();
        if (trimmed.startsWith('[')) {
          stepDescriptions = JSON.parse(trimmed);
        } else if (trimmed.includes('\n')) {
          stepDescriptions = trimmed.split('\n').map(s => s.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
        } else {
          stepDescriptions = trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else {
        throw new Error('steps must be an array or string');
      }
      if (!Array.isArray(stepDescriptions) || stepDescriptions.length === 0) {
        throw new Error('steps must be a non-empty array');
      }
      // Ensure all items are strings
      stepDescriptions = stepDescriptions.map(s => String(s).trim()).filter(Boolean);
    } catch (e) {
      return { success: false, error: `Invalid steps format: ${e instanceof Error ? e.message : 'must be a JSON array of strings'}`, duration: Date.now() - start };
    }

    // Cap at 15 steps to prevent abuse
    if (stepDescriptions.length > 15) {
      stepDescriptions = stepDescriptions.slice(0, 15);
    }

    const planId = `plan-${++planCounter}-${Date.now()}`;
    const plan: ActivePlan = {
      id: planId,
      goal,
      steps: stepDescriptions.map((desc, i) => ({
        id: `${i + 1}`,
        description: desc,
        status: i === 0 ? 'in_progress' as const : 'pending' as const,
      })),
      status: 'active',
      createdAt: Date.now(),
    };

    if (sessionId) {
      // Replace any existing plan for this session
      sessionPlans.set(sessionId, plan);
      logger.info('Plan created', { planId, sessionId, goal, steps: plan.steps.length });
    } else {
      logger.warn('Plan created without sessionId — will not be tracked', { planId });
    }

    return {
      success: true,
      data: {
        planId,
        goal,
        totalSteps: plan.steps.length,
        currentStep: { id: '1', description: plan.steps[0].description },
        message: `Plan created with ${plan.steps.length} steps. Now execute step 1: ${plan.steps[0].description}`,
      },
      duration: Date.now() - start,
    };
  }
}

// ─── plan_update Tool ───────────────────────────────────

export class PlanUpdateTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'plan_update',
    description: 'Update the status of a plan step. Call this after completing each step to track progress. Automatically advances to the next step.',
    category: 'utility',
    parameters: [
      {
        name: 'stepId',
        type: 'string',
        description: 'The step number to update (e.g. "1", "2", "3")',
        required: true,
      },
      {
        name: 'status',
        type: 'string',
        description: 'New status: "completed", "failed", or "skipped"',
        required: true,
      },
      {
        name: 'note',
        type: 'string',
        description: 'Optional brief note about the step result',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now();
    const stepId = params['stepId'] as string;
    const status = params['status'] as string;
    const note = params['note'] as string | undefined;
    const sessionId = params['_sessionId'] as string | undefined;

    if (!stepId || !status) {
      return { success: false, error: 'stepId and status are required', duration: Date.now() - start };
    }

    if (!['completed', 'failed', 'skipped'].includes(status)) {
      return { success: false, error: 'status must be "completed", "failed", or "skipped"', duration: Date.now() - start };
    }

    const plan = sessionId ? sessionPlans.get(sessionId) : null;
    if (!plan || plan.status !== 'active') {
      return { success: false, error: 'No active plan found for this session', duration: Date.now() - start };
    }

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) {
      return { success: false, error: `Step ${stepId} not found in plan (valid: ${plan.steps.map(s => s.id).join(', ')})`, duration: Date.now() - start };
    }

    // Update step
    step.status = status as PlanStep['status'];
    if (note) step.result = note.substring(0, 200);

    // Auto-advance: set next pending step to in_progress
    if (status === 'completed' || status === 'skipped') {
      const nextPending = plan.steps.find(s => s.status === 'pending');
      if (nextPending) {
        nextPending.status = 'in_progress';
      }
    }

    // Check if plan is complete
    const allDone = plan.steps.every(s => ['completed', 'failed', 'skipped'].includes(s.status));
    if (allDone) {
      const hasAnySuccess = plan.steps.some(s => s.status === 'completed');
      plan.status = hasAnySuccess ? 'completed' : 'failed';
      plan.completedAt = Date.now();
      logger.info('Plan completed', { planId: plan.id, status: plan.status, duration: plan.completedAt - plan.createdAt });
    }

    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const currentStep = plan.steps.find(s => s.status === 'in_progress');

    logger.info('Plan step updated', { planId: plan.id, stepId, status, completed, total: plan.steps.length });

    return {
      success: true,
      data: {
        stepId,
        newStatus: status,
        progress: `${completed}/${plan.steps.length}`,
        planStatus: plan.status,
        currentStep: currentStep ? { id: currentStep.id, description: currentStep.description } : null,
        message: currentStep
          ? `Step ${stepId} marked ${status}. Next: step ${currentStep.id} — ${currentStep.description}`
          : `Step ${stepId} marked ${status}. Plan ${plan.status}.`,
      },
      duration: Date.now() - start,
    };
  }
}
