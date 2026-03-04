import { createLogger } from '@forgeai/shared';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const logger = createLogger('Agent:PromptOptimizer');

// ─── Types ──────────────────────────────────────────────

export type TaskCategory =
  | 'web_creation'
  | 'api_development'
  | 'data_analysis'
  | 'scripting'
  | 'research'
  | 'file_operations'
  | 'system_admin'
  | 'automation'
  | 'general';

export interface SuccessPattern {
  id: string;
  patternId: string;
  category: TaskCategory;
  taskSummary: string;
  toolSequence: string[];
  keyActions: string[];
  iterations: number;
  duration: number;
  score: number;
  timestamp: number;
  usageCount: number;
  // Aggregation fields (v2)
  occurrences: number;
  avgScore: number;
  avgDuration: number;
  avgIterations: number;
  firstSeen: number;
  lastSeen: number;
}

export interface FailurePattern {
  id: string;
  patternId: string;
  category: TaskCategory;
  taskSummary: string;
  failedTools: string[];
  failureReasons: string[];
  avoidance: string;
  timestamp: number;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
}

export interface CategoryStats {
  total: number;
  successes: number;
  failures: number;
  avgDuration: number;
  avgIterations: number;
  bestToolSequence: string[];
  commonFailures: string[];
}

export interface AgentStepInput {
  type: string;
  tool?: string;
  success?: boolean;
  result?: string;
  duration?: number;
  message?: string;
}

export interface OptimizerData {
  version: number;
  successPatterns: SuccessPattern[];
  failurePatterns: FailurePattern[];
  categoryStats: Record<string, CategoryStats>;
  lastUpdated: number;
}

// Schema version — bump when adding fields
const CURRENT_SCHEMA_VERSION = 2;

// ─── Category Detection ─────────────────────────────────

const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  web_creation: ['html', 'css', 'website', 'site', 'page', 'landing', 'frontend', 'react', 'vue', 'svelte', 'navbar', 'footer', 'dark theme', 'responsive', 'tailwind', 'bootstrap', 'página', 'criar site', 'criar pagina'],
  api_development: ['api', 'rest', 'endpoint', 'express', 'fastify', 'flask', 'django', 'swagger', 'crud', 'backend', 'server', 'route', 'middleware', 'jwt', 'autenticação'],
  data_analysis: ['csv', 'json data', 'chart', 'graph', 'analysis', 'dataset', 'gráfico', 'relatório', 'report', 'statistics', 'pandas', 'matplotlib', 'dashboard', 'dados'],
  scripting: ['script', 'python', 'bash', 'node', 'automation script', 'bot', 'cron', 'schedule', 'scraping', 'web scraper', 'crawl'],
  research: ['pesquise', 'search', 'research', 'compare', 'find information', 'notícias', 'news', 'últimas', 'preço', 'price', 'analise', 'review'],
  file_operations: ['create file', 'edit file', 'rename', 'move file', 'copy file', 'delete file', 'criar arquivo', 'editar arquivo', 'config', 'readme', '.env'],
  system_admin: ['docker', 'server', 'deploy', 'nginx', 'linux', 'ssh', 'systemctl', 'install', 'configure', 'setup', 'environment'],
  automation: ['automate', 'workflow', 'pipeline', 'schedule', 'cron', 'recurring', 'monitor', 'alert', 'webhook'],
  general: [],
};

// ─── Constants ──────────────────────────────────────────

const MAX_SUCCESS_PATTERNS = 50;
const MAX_FAILURE_PATTERNS = 30;
const PATTERN_DECAY_DAYS = 30;
const MIN_SCORE_FOR_INJECTION = 0.5;
const MAX_EXAMPLES_PER_CATEGORY = 3;

// ─── Pattern ID Helpers ─────────────────────────────────

function generatePatternId(category: string, toolSequence: string[], keyActions: string[]): string {
  const data = `s|${category}|${toolSequence.join(',')}|${[...keyActions].sort().join(',')}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function generateFailurePatternId(category: string, failedTools: string[]): string {
  const data = `f|${category}|${[...failedTools].sort().join(',')}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ─── PromptOptimizer ────────────────────────────────────

export class PromptOptimizer {
  private successPatterns: SuccessPattern[] = [];
  private failurePatterns: FailurePattern[] = [];
  private categoryStats: Map<TaskCategory, CategoryStats> = new Map();
  private persistPath: string | null = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(persistDir?: string) {
    if (persistDir) {
      this.persistPath = path.join(persistDir, 'prompt-optimizer.json');
      this.load();
    }

    // Auto-save every 60s if dirty
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.save();
    }, 60_000);

    logger.info('PromptOptimizer initialized', {
      patterns: this.successPatterns.length,
      failures: this.failurePatterns.length,
      persistPath: this.persistPath,
    });
  }

  destroy(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.dirty) this.save();
  }

  // ─── Task Classification ────────────────────────────

  classifyTask(content: string): TaskCategory {
    const lower = content.toLowerCase();
    let bestCategory: TaskCategory = 'general';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]) {
      if (category === 'general') continue;
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score += kw.length; // Longer matches score higher
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  // ─── Optimized Context Builder ──────────────────────

  buildOptimizedContext(userMessage: string): string | null {
    const category = this.classifyTask(userMessage);
    const stats = this.categoryStats.get(category);
    const lines: string[] = [];

    // Category stats header
    if (stats && stats.total >= 2) {
      const successRate = Math.round((stats.successes / stats.total) * 100);
      const avgDur = Math.round(stats.avgDuration / 1000);
      lines.push(`Task type: ${category} (${successRate}% success rate across ${stats.total} tasks, avg ${avgDur}s)`);

      if (stats.bestToolSequence.length > 0) {
        lines.push(`Best tool sequence: ${stats.bestToolSequence.join(' → ')}`);
      }
    }

    // Inject success patterns as few-shot examples
    const relevantSuccesses = this.getRelevantPatterns(category, userMessage);
    if (relevantSuccesses.length > 0) {
      lines.push('');
      lines.push('PROVEN STRATEGIES (from successful past tasks):');
      for (const p of relevantSuccesses.slice(0, MAX_EXAMPLES_PER_CATEGORY)) {
        const dur = Math.round(p.avgDuration / 1000);
        const occ = p.occurrences > 1 ? ` [${p.occurrences}x proven]` : '';
        lines.push(`- "${p.taskSummary}" → ${p.toolSequence.join(' → ')} (avg ${Math.round(p.avgIterations)} iters, ${dur}s, score: ${p.avgScore.toFixed(1)})${occ}`);
        if (p.keyActions.length > 0) {
          lines.push(`  Key actions: ${p.keyActions.join('; ')}`);
        }
      }
    }

    // Inject failure anti-patterns
    const relevantFailures = this.getRelevantFailures(category);
    if (relevantFailures.length > 0) {
      lines.push('');
      lines.push('AVOID (from past failures):');
      for (const f of relevantFailures.slice(0, 3)) {
        lines.push(`- ${f.avoidance} (occurred ${f.occurrences}x)`);
      }
    }

    // Category-specific optimized instructions
    const categoryInstructions = this.getCategoryInstructions(category, stats);
    if (categoryInstructions) {
      lines.push('');
      lines.push(categoryInstructions);
    }

    if (lines.length === 0) return null;

    return `Prompt Optimization (auto-learned from ${this.successPatterns.length + this.failurePatterns.length} past interactions):\n${lines.join('\n')}`;
  }

  // ─── Record Outcome ─────────────────────────────────

  recordOutcome(params: {
    task: string;
    steps: AgentStepInput[];
    success: boolean;
    reflectionTriggered: boolean;
    reflectionFixed: boolean;
    duration: number;
    iterations: number;
  }): void {
    const category = this.classifyTask(params.task);
    const toolCalls = params.steps.filter(s => s.type === 'tool_call' && s.tool);
    const toolResults = params.steps.filter(s => s.type === 'tool_result');
    const failures = toolResults.filter(s => !s.success);

    // Calculate score
    let score = 0;
    if (params.success) {
      score = 0.6; // Base score for success
      if (params.reflectionTriggered && !params.reflectionFixed) {
        score += 0.3; // Reflection passed without needing fixes = excellent
      } else if (!params.reflectionTriggered && failures.length === 0) {
        score += 0.2; // Clean execution without reflection = good
      }
      if (failures.length === 0) score += 0.1; // No tool failures
      // Penalize for excessive iterations
      if (params.iterations > 10) score -= 0.1;
      if (params.iterations > 20) score -= 0.1;
    } else {
      score = 0.1; // Failed task
    }
    score = Math.max(0, Math.min(1, score));

    // Extract tool sequence (deduplicated consecutive)
    const toolSequence: string[] = [];
    for (const tc of toolCalls) {
      if (tc.tool && (toolSequence.length === 0 || toolSequence[toolSequence.length - 1] !== tc.tool)) {
        toolSequence.push(tc.tool);
      }
    }

    // Extract key actions (successful tool results with meaningful output)
    const keyActions: string[] = [];
    for (const tr of toolResults.filter(s => s.success && s.tool)) {
      const action = `${tr.tool}${tr.message ? ': ' + tr.message.substring(0, 60) : ''}`;
      if (!keyActions.includes(action)) keyActions.push(action);
    }

    const taskSummary = params.task.substring(0, 120).replace(/\n/g, ' ');

    if (params.success && score >= MIN_SCORE_FOR_INJECTION) {
      const now = Date.now();
      const pid = generatePatternId(category, toolSequence.slice(0, 10), keyActions.slice(0, 5));

      // Dedup: find existing pattern with same fingerprint
      const existing = this.successPatterns.find(p => p.patternId === pid);

      if (existing) {
        // Aggregate: running averages + update metadata
        existing.occurrences++;
        existing.avgScore = existing.avgScore + (score - existing.avgScore) / existing.occurrences;
        existing.avgDuration = existing.avgDuration + (params.duration - existing.avgDuration) / existing.occurrences;
        existing.avgIterations = existing.avgIterations + (params.iterations - existing.avgIterations) / existing.occurrences;
        existing.lastSeen = now;
        existing.timestamp = now;
        existing.score = score;
        existing.duration = params.duration;
        existing.iterations = params.iterations;
        existing.taskSummary = taskSummary;

        logger.info('Success pattern aggregated', {
          patternId: pid,
          category,
          occurrences: existing.occurrences,
          avgScore: existing.avgScore.toFixed(2),
        });
      } else {
        // New pattern
        const pattern: SuccessPattern = {
          id: `sp-${now}-${Math.random().toString(36).slice(2, 6)}`,
          patternId: pid,
          category,
          taskSummary,
          toolSequence: toolSequence.slice(0, 10),
          keyActions: keyActions.slice(0, 5),
          iterations: params.iterations,
          duration: params.duration,
          score,
          timestamp: now,
          usageCount: 0,
          occurrences: 1,
          avgScore: score,
          avgDuration: params.duration,
          avgIterations: params.iterations,
          firstSeen: now,
          lastSeen: now,
        };

        this.successPatterns.push(pattern);
        this.pruneSuccessPatterns();

        logger.info('Success pattern recorded', {
          patternId: pid,
          category,
          score: score.toFixed(2),
          tools: toolSequence.length,
          iterations: params.iterations,
        });
      }
    }

    // Record failures (with dedup via patternId)
    if (failures.length > 0) {
      const failedTools = [...new Set(failures.map(f => f.tool).filter(Boolean) as string[])];
      const failureReasons = failures
        .map(f => f.result?.substring(0, 100) ?? f.message?.substring(0, 100) ?? 'unknown')
        .filter(Boolean)
        .slice(0, 3);

      const fpid = generateFailurePatternId(category, failedTools);
      const existingFailure = this.failurePatterns.find(fp => fp.patternId === fpid);

      if (existingFailure) {
        existingFailure.occurrences++;
        existingFailure.lastSeen = Date.now();
        existingFailure.timestamp = Date.now();
        // Merge new failure reasons
        for (const reason of failureReasons) {
          if (!existingFailure.failureReasons.includes(reason)) {
            existingFailure.failureReasons.push(reason);
          }
        }
      } else {
        const now = Date.now();
        const avoidance = this.generateAvoidanceInstruction(failedTools, failureReasons, category);
        this.failurePatterns.push({
          id: `fp-${now}-${Math.random().toString(36).slice(2, 6)}`,
          patternId: fpid,
          category,
          taskSummary,
          failedTools,
          failureReasons: failureReasons.slice(0, 5),
          avoidance,
          timestamp: now,
          occurrences: 1,
          firstSeen: now,
          lastSeen: now,
        });
        this.pruneFailurePatterns();
      }
    }

    // Update category stats
    this.updateCategoryStats(category, params.success, params.duration, params.iterations, toolSequence);
    this.dirty = true;
  }

  // ─── Internal Helpers ───────────────────────────────

  private getRelevantPatterns(category: TaskCategory, _userMessage: string): SuccessPattern[] {
    const now = Date.now();
    const decayMs = PATTERN_DECAY_DAYS * 24 * 60 * 60 * 1000;

    return this.successPatterns
      .filter(p => p.category === category && p.avgScore >= MIN_SCORE_FOR_INJECTION)
      .map(p => {
        // Apply time decay based on lastSeen (not timestamp)
        const age = now - p.lastSeen;
        const decayFactor = Math.max(0.3, 1 - (age / decayMs));
        // Patterns proven multiple times get a confidence boost (log scale)
        const confidenceBoost = 1 + Math.log2(Math.min(p.occurrences, 16)) * 0.1;
        return { ...p, effectiveScore: p.avgScore * decayFactor * confidenceBoost };
      })
      .sort((a, b) => (b as any).effectiveScore - (a as any).effectiveScore)
      .slice(0, MAX_EXAMPLES_PER_CATEGORY);
  }

  private getRelevantFailures(category: TaskCategory): FailurePattern[] {
    return this.failurePatterns
      .filter(f => f.category === category)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 3);
  }

  private generateAvoidanceInstruction(
    failedTools: string[],
    failureReasons: string[],
    _category: TaskCategory,
  ): string {
    const toolNames = failedTools.join(', ');
    const reason = failureReasons[0] ?? 'execution error';
    return `${toolNames} failed: "${reason.substring(0, 80)}". Use alternative approach.`;
  }

  private getCategoryInstructions(category: TaskCategory, stats?: CategoryStats): string | null {
    if (!stats || stats.total < 3) return null;

    const successRate = stats.successes / stats.total;
    if (successRate >= 0.8) return null; // Already good, no extra instructions needed

    // Generate improvement hints for categories with low success rates
    const hints: string[] = [];
    if (successRate < 0.5) {
      hints.push(`WARNING: ${category} tasks have a ${Math.round(successRate * 100)}% success rate. Be extra careful.`);
    }
    if (stats.commonFailures.length > 0) {
      hints.push(`Common failures: ${stats.commonFailures.slice(0, 3).join('; ')}`);
    }
    if (stats.avgIterations > 10) {
      hints.push(`Tasks in this category avg ${Math.round(stats.avgIterations)} iterations. Plan efficiently to reduce.`);
    }

    return hints.length > 0 ? hints.join('\n') : null;
  }

  private updateCategoryStats(
    category: TaskCategory,
    success: boolean,
    duration: number,
    iterations: number,
    toolSequence: string[],
  ): void {
    const existing = this.categoryStats.get(category) ?? {
      total: 0,
      successes: 0,
      failures: 0,
      avgDuration: 0,
      avgIterations: 0,
      bestToolSequence: [],
      commonFailures: [],
    };

    existing.total++;
    if (success) existing.successes++;
    else existing.failures++;

    // Running average
    existing.avgDuration = existing.avgDuration + (duration - existing.avgDuration) / existing.total;
    existing.avgIterations = existing.avgIterations + (iterations - existing.avgIterations) / existing.total;

    // Track best tool sequence (from highest-scoring success)
    if (success && toolSequence.length > 0) {
      const bestPattern = this.successPatterns
        .filter(p => p.category === category)
        .sort((a, b) => b.score - a.score)[0];
      if (bestPattern) {
        existing.bestToolSequence = bestPattern.toolSequence;
      }
    }

    // Track common failures
    const recentFailures = this.failurePatterns
      .filter(f => f.category === category)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 3)
      .map(f => f.avoidance);
    existing.commonFailures = recentFailures;

    this.categoryStats.set(category, existing);
  }

  private pruneSuccessPatterns(): void {
    if (this.successPatterns.length <= MAX_SUCCESS_PATTERNS) return;

    // Sort by avgScore * recency * confidence, keep top N
    const now = Date.now();
    const decayMs = PATTERN_DECAY_DAYS * 24 * 60 * 60 * 1000;
    this.successPatterns.sort((a, b) => {
      const aDecay = Math.max(0.3, 1 - (now - a.lastSeen) / decayMs);
      const bDecay = Math.max(0.3, 1 - (now - b.lastSeen) / decayMs);
      const aConf = 1 + Math.log2(Math.min(a.occurrences, 16)) * 0.1;
      const bConf = 1 + Math.log2(Math.min(b.occurrences, 16)) * 0.1;
      return (b.avgScore * bDecay * bConf) - (a.avgScore * aDecay * aConf);
    });
    this.successPatterns = this.successPatterns.slice(0, MAX_SUCCESS_PATTERNS);
  }

  private pruneFailurePatterns(): void {
    if (this.failurePatterns.length <= MAX_FAILURE_PATTERNS) return;
    this.failurePatterns.sort((a, b) => b.occurrences - a.occurrences);
    this.failurePatterns = this.failurePatterns.slice(0, MAX_FAILURE_PATTERNS);
  }

  // ─── Persistence ────────────────────────────────────

  save(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const data: OptimizerData = {
        version: CURRENT_SCHEMA_VERSION,
        successPatterns: this.successPatterns,
        failurePatterns: this.failurePatterns,
        categoryStats: Object.fromEntries(this.categoryStats),
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
      this.dirty = false;
      logger.debug('Optimizer data saved', { version: CURRENT_SCHEMA_VERSION, patterns: this.successPatterns.length, failures: this.failurePatterns.length });
    } catch (err) {
      logger.warn('Failed to save optimizer data', { error: err });
    }
  }

  load(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as OptimizerData;

      // Migration: v1 → v2 (add patternId, aggregation fields, lastSeen/firstSeen)
      if (data.version === 1) {
        logger.info('Migrating optimizer data v1 → v2');
        data.successPatterns = (data.successPatterns ?? []).map((p: any) => ({
          ...p,
          patternId: p.patternId || generatePatternId(p.category, p.toolSequence ?? [], p.keyActions ?? []),
          occurrences: p.occurrences ?? 1,
          avgScore: p.avgScore ?? p.score ?? 0,
          avgDuration: p.avgDuration ?? p.duration ?? 0,
          avgIterations: p.avgIterations ?? p.iterations ?? 0,
          firstSeen: p.firstSeen ?? p.timestamp ?? Date.now(),
          lastSeen: p.lastSeen ?? p.timestamp ?? Date.now(),
        }));
        data.failurePatterns = (data.failurePatterns ?? []).map((f: any) => ({
          ...f,
          patternId: f.patternId || generateFailurePatternId(f.category, f.failedTools ?? []),
          firstSeen: f.firstSeen ?? f.timestamp ?? Date.now(),
          lastSeen: f.lastSeen ?? f.timestamp ?? Date.now(),
        }));
        data.version = CURRENT_SCHEMA_VERSION;
        // Save migrated data immediately
        this.dirty = true;
      }

      if (data.version !== CURRENT_SCHEMA_VERSION) {
        logger.warn('Unknown optimizer data version, skipping load', { version: data.version });
        return;
      }

      this.successPatterns = data.successPatterns ?? [];
      this.failurePatterns = data.failurePatterns ?? [];
      this.categoryStats = new Map(Object.entries(data.categoryStats ?? {})) as Map<TaskCategory, CategoryStats>;

      // Deduplicate patterns that may have the same patternId after migration
      this.deduplicatePatterns();

      logger.info('Optimizer data loaded', {
        version: CURRENT_SCHEMA_VERSION,
        patterns: this.successPatterns.length,
        failures: this.failurePatterns.length,
        categories: this.categoryStats.size,
      });
    } catch (err) {
      logger.warn('Failed to load optimizer data', { error: err });
    }
  }

  private deduplicatePatterns(): void {
    // Deduplicate success patterns by patternId (keep highest avgScore)
    const successMap = new Map<string, SuccessPattern>();
    for (const p of this.successPatterns) {
      const existing = successMap.get(p.patternId);
      if (!existing) {
        successMap.set(p.patternId, p);
      } else {
        // Merge: accumulate occurrences, keep best avg score, update timestamps
        existing.occurrences += p.occurrences;
        existing.avgScore = (existing.avgScore + p.avgScore) / 2;
        existing.avgDuration = (existing.avgDuration + p.avgDuration) / 2;
        existing.avgIterations = (existing.avgIterations + p.avgIterations) / 2;
        existing.firstSeen = Math.min(existing.firstSeen, p.firstSeen);
        existing.lastSeen = Math.max(existing.lastSeen, p.lastSeen);
      }
    }
    this.successPatterns = [...successMap.values()];

    // Deduplicate failure patterns by patternId
    const failureMap = new Map<string, FailurePattern>();
    for (const f of this.failurePatterns) {
      const existing = failureMap.get(f.patternId);
      if (!existing) {
        failureMap.set(f.patternId, f);
      } else {
        existing.occurrences += f.occurrences;
        existing.firstSeen = Math.min(existing.firstSeen, f.firstSeen);
        existing.lastSeen = Math.max(existing.lastSeen, f.lastSeen);
        for (const reason of f.failureReasons) {
          if (!existing.failureReasons.includes(reason)) {
            existing.failureReasons.push(reason);
          }
        }
      }
    }
    this.failurePatterns = [...failureMap.values()];
  }

  // ─── Stats ──────────────────────────────────────────

  getStats(): {
    totalPatterns: number;
    totalFailures: number;
    totalObservations: number;
    avgPatternOccurrences: number;
    topPatterns: Array<{ patternId: string; category: string; occurrences: number; avgScore: number }>;
    categories: Record<string, { total: number; successRate: number }>;
  } {
    const categories: Record<string, { total: number; successRate: number }> = {};
    for (const [cat, stats] of this.categoryStats) {
      categories[cat] = {
        total: stats.total,
        successRate: stats.total > 0 ? stats.successes / stats.total : 0,
      };
    }

    const totalObs = this.successPatterns.reduce((sum, p) => sum + p.occurrences, 0);
    const avgOcc = this.successPatterns.length > 0 ? totalObs / this.successPatterns.length : 0;

    const topPatterns = [...this.successPatterns]
      .sort((a, b) => b.avgScore * b.occurrences - a.avgScore * a.occurrences)
      .slice(0, 5)
      .map(p => ({
        patternId: p.patternId,
        category: p.category,
        occurrences: p.occurrences,
        avgScore: Math.round(p.avgScore * 100) / 100,
      }));

    return {
      totalPatterns: this.successPatterns.length,
      totalFailures: this.failurePatterns.length,
      totalObservations: totalObs,
      avgPatternOccurrences: Math.round(avgOcc * 10) / 10,
      topPatterns,
      categories,
    };
  }
}

export function createPromptOptimizer(persistDir?: string): PromptOptimizer {
  return new PromptOptimizer(persistDir);
}
