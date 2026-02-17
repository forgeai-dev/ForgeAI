export type StepType = 'tool' | 'condition' | 'delay' | 'transform' | 'parallel';

export type WorkflowStatus = 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: StepConfig;
  onError?: 'stop' | 'skip' | 'retry';
  retryCount?: number;
  dependsOn?: string[];
}

export type StepConfig =
  | ToolStepConfig
  | ConditionStepConfig
  | DelayStepConfig
  | TransformStepConfig
  | ParallelStepConfig;

export interface ToolStepConfig {
  type: 'tool';
  toolName: string;
  params: Record<string, unknown>;
}

export interface ConditionStepConfig {
  type: 'condition';
  expression: string;
  thenSteps: string[];
  elseSteps?: string[];
}

export interface DelayStepConfig {
  type: 'delay';
  ms: number;
}

export interface TransformStepConfig {
  type: 'transform';
  code: string;
}

export interface ParallelStepConfig {
  type: 'parallel';
  stepIds: string[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  variables: Record<string, unknown>;
  stepResults: Map<string, StepResult>;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  duration?: number;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  data?: unknown;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
}
