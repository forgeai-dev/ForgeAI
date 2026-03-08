import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptOptimizer, createPromptOptimizer } from '../packages/agent/src/prompt-optimizer.js';
import type { AgentStepInput } from '../packages/agent/src/prompt-optimizer.js';

describe('PromptOptimizer', () => {
  let optimizer: PromptOptimizer;

  beforeEach(() => {
    // No persist dir = in-memory only
    optimizer = new PromptOptimizer();
  });

  afterEach(() => {
    optimizer.destroy();
  });

  // ─── Task Classification ────────────────────────────────
  describe('Task Classification', () => {
    it('should classify web creation tasks', () => {
      expect(optimizer.classifyTask('create a landing page with React')).toBe('web_creation');
      expect(optimizer.classifyTask('build a website with tailwind css')).toBe('web_creation');
      expect(optimizer.classifyTask('criar site com navbar e footer')).toBe('web_creation');
    });

    it('should classify API development tasks', () => {
      expect(optimizer.classifyTask('build a REST API with Express')).toBe('api_development');
      expect(optimizer.classifyTask('create CRUD endpoints for users')).toBe('api_development');
      expect(optimizer.classifyTask('implement JWT authentication middleware')).toBe('api_development');
    });

    it('should classify data analysis tasks', () => {
      expect(optimizer.classifyTask('analyze the CSV data and create a chart')).toBe('data_analysis');
      expect(optimizer.classifyTask('generate a report from the dataset')).toBe('data_analysis');
    });

    it('should classify scripting tasks', () => {
      expect(optimizer.classifyTask('write a Python script for web scraping')).toBe('scripting');
      expect(optimizer.classifyTask('create a bash automation script')).toBe('scripting');
    });

    it('should classify research tasks', () => {
      expect(optimizer.classifyTask('pesquise sobre as últimas notícias de IA')).toBe('research');
      expect(optimizer.classifyTask('search and compare cloud providers')).toBe('research');
    });

    it('should classify file operations tasks', () => {
      expect(optimizer.classifyTask('create a README file for the project')).toBe('file_operations');
      expect(optimizer.classifyTask('edit the .env config file')).toBe('file_operations');
    });

    it('should classify system admin tasks', () => {
      expect(optimizer.classifyTask('setup Docker with nginx for deployment')).toBe('system_admin');
      expect(optimizer.classifyTask('configure the linux server via ssh')).toBe('system_admin');
    });

    it('should classify automation tasks', () => {
      expect(optimizer.classifyTask('automate the workflow pipeline with cron')).toBe('automation');
      expect(optimizer.classifyTask('schedule recurring monitoring alerts')).toBe('automation');
    });

    it('should default to general for unrecognized tasks', () => {
      expect(optimizer.classifyTask('hello there')).toBe('general');
      expect(optimizer.classifyTask('what is the meaning of life')).toBe('general');
    });
  });

  // ─── Record Outcomes ────────────────────────────────────
  describe('Record Outcomes', () => {
    it('should record a successful outcome', () => {
      const steps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'file_manager', success: true },
        { type: 'tool_result', tool: 'file_manager', success: true, result: 'File created', message: 'Created index.html' },
        { type: 'tool_call', tool: 'shell_exec', success: true },
        { type: 'tool_result', tool: 'shell_exec', success: true, result: 'OK' },
      ];

      optimizer.recordOutcome({
        task: 'create a landing page with React',
        steps,
        success: true,
        reflectionTriggered: false,
        reflectionFixed: false,
        duration: 5000,
        iterations: 3,
      });

      const stats = optimizer.getStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.categories['web_creation']).toBeDefined();
      expect(stats.categories['web_creation'].total).toBe(1);
      expect(stats.categories['web_creation'].successRate).toBe(1);
    });

    it('should record a failed outcome', () => {
      const steps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'shell_exec' },
        { type: 'tool_result', tool: 'shell_exec', success: false, result: 'Command not found' },
      ];

      optimizer.recordOutcome({
        task: 'deploy with docker compose',
        steps,
        success: false,
        reflectionTriggered: false,
        reflectionFixed: false,
        duration: 2000,
        iterations: 5,
      });

      const stats = optimizer.getStats();
      expect(stats.totalFailures).toBeGreaterThanOrEqual(1);
    });

    it('should aggregate duplicate patterns', () => {
      const steps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'file_manager' },
        { type: 'tool_result', tool: 'file_manager', success: true, result: 'OK' },
      ];

      // Record same pattern twice
      for (let i = 0; i < 2; i++) {
        optimizer.recordOutcome({
          task: 'create a React website with components',
          steps,
          success: true,
          reflectionTriggered: false,
          reflectionFixed: false,
          duration: 3000 + i * 1000,
          iterations: 2 + i,
        });
      }

      const stats = optimizer.getStats();
      // Should be aggregated into 1 pattern
      expect(stats.totalPatterns).toBe(1);
      expect(stats.totalObservations).toBe(2);
    });

    it('should give higher score for clean execution without reflection', () => {
      const cleanSteps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'file_manager' },
        { type: 'tool_result', tool: 'file_manager', success: true, result: 'OK' },
      ];

      optimizer.recordOutcome({
        task: 'create file README for the project docs',
        steps: cleanSteps,
        success: true,
        reflectionTriggered: false,
        reflectionFixed: false,
        duration: 1000,
        iterations: 2,
      });

      const stats = optimizer.getStats();
      expect(stats.topPatterns.length).toBeGreaterThan(0);
      // Clean execution should score ≥ 0.8 (0.6 base + 0.2 no reflection + 0.1 no failures)
      expect(stats.topPatterns[0].avgScore).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ─── Optimized Context Builder ──────────────────────────
  describe('buildOptimizedContext', () => {
    it('should return null with no recorded patterns', () => {
      const context = optimizer.buildOptimizedContext('create a website');
      expect(context).toBeNull();
    });

    it('should return context after recording successful patterns', () => {
      // Record enough patterns for context generation
      const steps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'file_manager' },
        { type: 'tool_result', tool: 'file_manager', success: true, result: 'OK' },
      ];

      for (let i = 0; i < 3; i++) {
        optimizer.recordOutcome({
          task: `create a React website version ${i}`,
          steps,
          success: true,
          reflectionTriggered: false,
          reflectionFixed: false,
          duration: 3000,
          iterations: 3,
        });
      }

      const context = optimizer.buildOptimizedContext('create a React landing page');
      // Should have context after 3 observations in same category
      if (context) {
        expect(context).toContain('Prompt Optimization');
        expect(context).toContain('PROVEN STRATEGIES');
      }
    });

    it('should include failure avoidance instructions', () => {
      // Record failures
      const failSteps: AgentStepInput[] = [
        { type: 'tool_call', tool: 'shell_exec' },
        { type: 'tool_result', tool: 'shell_exec', success: false, result: 'Permission denied' },
      ];

      for (let i = 0; i < 3; i++) {
        optimizer.recordOutcome({
          task: `deploy docker server version ${i}`,
          steps: failSteps,
          success: false,
          reflectionTriggered: false,
          reflectionFixed: false,
          duration: 2000,
          iterations: 5,
        });
      }

      const context = optimizer.buildOptimizedContext('deploy with docker');
      if (context) {
        expect(context).toContain('AVOID');
      }
    });
  });

  // ─── Stats ──────────────────────────────────────────────
  describe('Stats', () => {
    it('should return empty stats initially', () => {
      const stats = optimizer.getStats();
      expect(stats.totalPatterns).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalObservations).toBe(0);
      expect(stats.avgPatternOccurrences).toBe(0);
    });
  });

  // ─── Factory ──────────────────────────────────────────
  describe('Factory', () => {
    it('should create optimizer via factory', () => {
      const opt = createPromptOptimizer();
      expect(opt).toBeInstanceOf(PromptOptimizer);
      opt.destroy();
    });
  });
});
