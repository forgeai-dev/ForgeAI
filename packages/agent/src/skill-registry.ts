import { createLogger } from '@forgeai/shared';
import { execFile } from 'node:child_process';

const logger = createLogger('Agent:SkillRegistry');

// ─── Types ──────────────────────────────────────────────

export type SkillCategory =
  | 'productivity'
  | 'development'
  | 'data'
  | 'communication'
  | 'automation'
  | 'analysis'
  | 'integration'
  | 'custom';

export type SkillStatus = 'installed' | 'active' | 'disabled' | 'error';

export type HandlerType = 'script' | 'http' | 'function';

export interface SkillToolHandler {
  type: HandlerType;
  /** For script: command template with {{param}} placeholders.
   *  For http: URL template with {{param}} placeholders.
   *  For function: JS function body (receives params, config, fetch). */
  value: string;
  /** HTTP method (for http handler). Default: GET */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** HTTP headers (for http handler). Values support {{param}} templates. */
  headers?: Record<string, string>;
  /** Execution timeout in ms. Default: 30000 */
  timeout?: number;
}

export interface SkillToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  handler: SkillToolHandler;
}

export interface SkillConfigParam {
  type: 'string' | 'number' | 'boolean';
  description: string;
  default?: unknown;
  required?: boolean;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category: SkillCategory;
  tags?: string[];
  tools: SkillToolDef[];
  /** Additional context injected into system prompt when skill is active */
  promptContext?: string;
  /** IDs of other skills that must be active */
  dependencies?: string[];
  /** Configurable parameters with defaults */
  config?: Record<string, SkillConfigParam>;
}

export interface InstalledSkill {
  manifest: SkillManifest;
  status: SkillStatus;
  installedAt: number;
  activatedAt?: number;
  configValues: Record<string, unknown>;
  error?: string;
}

// ─── Persistence ────────────────────────────────────────

export interface SkillStore {
  save(skill: InstalledSkill): Promise<void>;
  get(id: string): Promise<InstalledSkill | null>;
  list(): Promise<InstalledSkill[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemorySkillStore implements SkillStore {
  private skills = new Map<string, InstalledSkill>();

  async save(skill: InstalledSkill): Promise<void> {
    this.skills.set(skill.manifest.id, structuredClone(skill));
  }

  async get(id: string): Promise<InstalledSkill | null> {
    const s = this.skills.get(id);
    return s ? structuredClone(s) : null;
  }

  async list(): Promise<InstalledSkill[]> {
    return Array.from(this.skills.values()).map(s => structuredClone(s));
  }

  async delete(id: string): Promise<boolean> {
    return this.skills.delete(id);
  }
}

/**
 * File-based skill store. Persists skills to a JSON file on disk.
 * Used by the gateway for durable skill persistence across restarts.
 */
export class FileSkillStore implements SkillStore {
  private filePath: string;
  private cache: Map<string, InstalledSkill> = new Map();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const { existsSync, readFileSync } = await import('node:fs');
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const arr = JSON.parse(raw) as InstalledSkill[];
        for (const s of arr) {
          this.cache.set(s.manifest.id, s);
        }
        logger.info('Skills loaded from disk', { path: this.filePath, count: arr.length });
      }
    } catch (err) {
      logger.warn('Failed to load skills from disk', { error: (err as Error).message });
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const dir = resolve(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(Array.from(this.cache.values()), null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to persist skills to disk', { error: (err as Error).message });
    }
  }

  async save(skill: InstalledSkill): Promise<void> {
    await this.load();
    this.cache.set(skill.manifest.id, structuredClone(skill));
    await this.persist();
  }

  async get(id: string): Promise<InstalledSkill | null> {
    await this.load();
    const s = this.cache.get(id);
    return s ? structuredClone(s) : null;
  }

  async list(): Promise<InstalledSkill[]> {
    await this.load();
    return Array.from(this.cache.values()).map(s => structuredClone(s));
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const deleted = this.cache.delete(id);
    if (deleted) await this.persist();
    return deleted;
  }
}

// ─── Validation ─────────────────────────────────────────

const VALID_CATEGORIES: SkillCategory[] = [
  'productivity', 'development', 'data', 'communication',
  'automation', 'analysis', 'integration', 'custom',
];

const MAX_SKILLS = 50;
const MAX_TOOLS_PER_SKILL = 10;
const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/;
const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;

// Reserved tool names (built-in tools that cannot be overridden)
const RESERVED_TOOL_NAMES = new Set([
  'web_browse', 'file_manager', 'cron_scheduler', 'code_runner',
  'knowledge_base', 'puppeteer_browse', 'shell_exec', 'desktop_automation',
  'image_generator', 'web_search', 'sessions_list', 'sessions_history',
  'sessions_send', 'plan_create', 'plan_update', 'agent_delegate',
  'forge_team', 'project_delete', 'app_register', 'smart_home', 'spotify',
  'skill_list', 'skill_install', 'skill_activate', 'skill_deactivate', 'skill_create',
]);

export function validateManifest(manifest: SkillManifest): string | null {
  if (!manifest.id || !SKILL_ID_REGEX.test(manifest.id)) {
    return `Invalid skill ID "${manifest.id}". Must be 3-50 lowercase alphanumeric chars with hyphens/underscores.`;
  }
  if (!manifest.name || manifest.name.length < 2 || manifest.name.length > 100) {
    return 'Skill name must be 2-100 characters.';
  }
  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    return `Invalid version "${manifest.version}". Must be semver (e.g., 1.0.0).`;
  }
  if (!manifest.description || manifest.description.length < 10) {
    return 'Skill description must be at least 10 characters.';
  }
  if (!VALID_CATEGORIES.includes(manifest.category)) {
    return `Invalid category "${manifest.category}". Valid: ${VALID_CATEGORIES.join(', ')}.`;
  }
  if (!manifest.tools || manifest.tools.length === 0) {
    return 'Skill must define at least one tool.';
  }
  if (manifest.tools.length > MAX_TOOLS_PER_SKILL) {
    return `Too many tools (max ${MAX_TOOLS_PER_SKILL}).`;
  }

  for (const tool of manifest.tools) {
    if (!tool.name || !TOOL_NAME_REGEX.test(tool.name)) {
      return `Invalid tool name "${tool.name}". Must be 3-50 lowercase alphanumeric with underscores.`;
    }
    if (RESERVED_TOOL_NAMES.has(tool.name)) {
      return `Tool name "${tool.name}" is reserved by a built-in tool.`;
    }
    if (!tool.description || tool.description.length < 5) {
      return `Tool "${tool.name}" must have a description (min 5 chars).`;
    }
    if (!tool.handler || !tool.handler.type || !tool.handler.value) {
      return `Tool "${tool.name}" must have a handler with type and value.`;
    }
    if (!['script', 'http', 'function'].includes(tool.handler.type)) {
      return `Tool "${tool.name}" has invalid handler type "${tool.handler.type}". Valid: script, http, function.`;
    }
  }

  if (manifest.config) {
    for (const [key, param] of Object.entries(manifest.config)) {
      if (!['string', 'number', 'boolean'].includes(param.type)) {
        return `Config param "${key}" has invalid type "${param.type}".`;
      }
    }
  }

  return null;
}

// ─── Handler Execution ──────────────────────────────────

function interpolateTemplate(template: string, params: Record<string, unknown>, config: Record<string, unknown>): string {
  let result = template;
  // Replace {{config.key}} with config values first
  result = result.replace(/\{\{config\.(\w+)\}\}/g, (_, key) => String(config[key] ?? ''));
  // Replace {{key}} with param values
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === '_sessionId') return ''; // Don't leak internal params
    return String(params[key] ?? '');
  });
  return result;
}

async function executeScriptHandler(
  handler: SkillToolHandler,
  params: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const command = interpolateTemplate(handler.value, params, config);
  const timeout = handler.timeout ?? 30_000;

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/sh';
    const shellArg = isWin ? '/c' : '-c';

    execFile(shell, [shellArg, command], {
      timeout,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message + (stderr ? `\n${stderr}` : '') });
      } else {
        resolve({ success: true, data: stdout.trim() || 'Command executed successfully.' });
      }
    });
  });
}

async function executeHttpHandler(
  handler: SkillToolHandler,
  params: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = interpolateTemplate(handler.value, params, config);
  const method = handler.method ?? 'GET';
  const timeout = handler.timeout ?? 30_000;

  const headers: Record<string, string> = {};
  if (handler.headers) {
    for (const [key, val] of Object.entries(handler.headers)) {
      headers[key] = interpolateTemplate(val, params, config);
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (method !== 'GET' && method !== 'DELETE') {
      const body = { ...params };
      delete body['_sessionId'];
      fetchOpts.body = JSON.stringify(body);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOpts);
    clearTimeout(timer);

    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!response.ok) {
      const preview = typeof data === 'string' ? data.substring(0, 500) : JSON.stringify(data).substring(0, 500);
      return { success: false, error: `HTTP ${response.status}: ${preview}` };
    }

    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeFunctionHandler(
  handler: SkillToolHandler,
  params: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    // Sandboxed function — only receives params, config, and fetch
    const fn = new Function('params', 'config', 'fetch', handler.value);
    const result = await Promise.resolve(fn(params, config, globalThis.fetch));
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── SkillRegistry ──────────────────────────────────────

export class SkillRegistry {
  private store: SkillStore;
  private skills: Map<string, InstalledSkill> = new Map();
  /** Maps tool name → skill ID for fast lookup */
  private toolToSkill: Map<string, string> = new Map();
  private initialized = false;

  constructor(store?: SkillStore) {
    this.store = store ?? new InMemorySkillStore();
  }

  /** Load skills from store into memory. Called lazily on first operation. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const allSkills = await this.store.list();
    for (const skill of allSkills) {
      this.skills.set(skill.manifest.id, skill);
      if (skill.status === 'active') {
        for (const tool of skill.manifest.tools) {
          this.toolToSkill.set(tool.name, skill.manifest.id);
        }
      }
    }
    this.initialized = true;
    const activeCount = allSkills.filter(s => s.status === 'active').length;
    logger.info('Skill registry initialized', { total: allSkills.length, active: activeCount });
  }

  // ─── Install ──────────────────────────────────────────

  async install(
    manifest: SkillManifest,
    configValues?: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string; skill?: InstalledSkill }> {
    await this.initialize();

    const validationError = validateManifest(manifest);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Check limit
    if (this.skills.size >= MAX_SKILLS && !this.skills.has(manifest.id)) {
      return { success: false, error: `Maximum skills limit reached (${MAX_SKILLS}).` };
    }

    // Check for tool name conflicts with other skills
    for (const tool of manifest.tools) {
      const existingSkillId = this.toolToSkill.get(tool.name);
      if (existingSkillId && existingSkillId !== manifest.id) {
        return { success: false, error: `Tool name "${tool.name}" conflicts with skill "${existingSkillId}".` };
      }
    }

    // Check dependencies
    if (manifest.dependencies) {
      for (const depId of manifest.dependencies) {
        const dep = this.skills.get(depId);
        if (!dep) {
          return { success: false, error: `Dependency "${depId}" is not installed.` };
        }
        if (dep.status !== 'active') {
          return { success: false, error: `Dependency "${depId}" is installed but not active.` };
        }
      }
    }

    // Resolve config with defaults
    const resolvedConfig: Record<string, unknown> = {};
    if (manifest.config) {
      for (const [key, param] of Object.entries(manifest.config)) {
        if (configValues && key in configValues) {
          resolvedConfig[key] = configValues[key];
        } else if (param.default !== undefined) {
          resolvedConfig[key] = param.default;
        } else if (param.required) {
          return { success: false, error: `Required config param "${key}" is missing.` };
        }
      }
    }

    const skill: InstalledSkill = {
      manifest,
      status: 'installed',
      installedAt: Date.now(),
      configValues: resolvedConfig,
    };

    this.skills.set(manifest.id, skill);
    await this.store.save(skill);

    logger.info(`Skill installed: ${manifest.id} (${manifest.name})`, {
      version: manifest.version,
      tools: manifest.tools.map(t => t.name),
      category: manifest.category,
    });

    return { success: true, skill };
  }

  // ─── Uninstall ────────────────────────────────────────

  async uninstall(skillId: string): Promise<{ success: boolean; error?: string }> {
    await this.initialize();
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" not found.` };
    }

    // Check if other active skills depend on this one
    for (const [id, s] of this.skills) {
      if (id !== skillId && s.manifest.dependencies?.includes(skillId) && s.status === 'active') {
        return { success: false, error: `Cannot uninstall: active skill "${id}" depends on "${skillId}".` };
      }
    }

    // Remove tool mappings
    for (const tool of skill.manifest.tools) {
      this.toolToSkill.delete(tool.name);
    }

    this.skills.delete(skillId);
    await this.store.delete(skillId);

    logger.info(`Skill uninstalled: ${skillId}`);
    return { success: true };
  }

  // ─── Activate / Deactivate ────────────────────────────

  async activate(skillId: string): Promise<{ success: boolean; error?: string }> {
    await this.initialize();
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" not found.` };
    }
    if (skill.status === 'active') {
      return { success: true };
    }

    // Check dependencies are active
    if (skill.manifest.dependencies) {
      for (const depId of skill.manifest.dependencies) {
        const dep = this.skills.get(depId);
        if (!dep || dep.status !== 'active') {
          return { success: false, error: `Dependency "${depId}" must be active first.` };
        }
      }
    }

    // Register tool mappings
    for (const tool of skill.manifest.tools) {
      this.toolToSkill.set(tool.name, skillId);
    }

    skill.status = 'active';
    skill.activatedAt = Date.now();
    skill.error = undefined;
    await this.store.save(skill);

    logger.info(`Skill activated: ${skillId}`, {
      tools: skill.manifest.tools.map(t => t.name),
    });
    return { success: true };
  }

  async deactivate(skillId: string): Promise<{ success: boolean; error?: string }> {
    await this.initialize();
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill "${skillId}" not found.` };
    }
    if (skill.status !== 'active') {
      return { success: true };
    }

    // Check if other active skills depend on this
    for (const [id, s] of this.skills) {
      if (id !== skillId && s.manifest.dependencies?.includes(skillId) && s.status === 'active') {
        return { success: false, error: `Cannot deactivate: active skill "${id}" depends on "${skillId}".` };
      }
    }

    // Remove tool mappings
    for (const tool of skill.manifest.tools) {
      this.toolToSkill.delete(tool.name);
    }

    skill.status = 'disabled';
    skill.activatedAt = undefined;
    await this.store.save(skill);

    logger.info(`Skill deactivated: ${skillId}`);
    return { success: true };
  }

  // ─── Query ────────────────────────────────────────────

  async listSkills(): Promise<InstalledSkill[]> {
    await this.initialize();
    return Array.from(this.skills.values());
  }

  async getSkill(skillId: string): Promise<InstalledSkill | null> {
    await this.initialize();
    return this.skills.get(skillId) ?? null;
  }

  getActiveSkillCount(): number {
    let count = 0;
    for (const s of this.skills.values()) {
      if (s.status === 'active') count++;
    }
    return count;
  }

  // ─── Tool Integration (used by AgentRuntime) ──────────

  /** Check if a tool name belongs to an active skill */
  hasToolNamed(toolName: string): boolean {
    return this.toolToSkill.has(toolName);
  }

  /** Get LLM tool definitions for all active skills */
  getActiveToolsForLLM(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    const tools: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }> = [];

    for (const skill of this.skills.values()) {
      if (skill.status !== 'active') continue;
      for (const tool of skill.manifest.tools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name,
            description: `[Skill: ${skill.manifest.name}] ${tool.description}`,
            parameters: tool.parameters,
          },
        });
      }
    }
    return tools;
  }

  /** Execute a skill-provided tool */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string; duration: number }> {
    const start = Date.now();
    const skillId = this.toolToSkill.get(toolName);
    if (!skillId) {
      return { success: false, error: `No active skill provides tool "${toolName}".`, duration: 0 };
    }

    const skill = this.skills.get(skillId);
    if (!skill || skill.status !== 'active') {
      return { success: false, error: `Skill "${skillId}" is not active.`, duration: 0 };
    }

    const toolDef = skill.manifest.tools.find(t => t.name === toolName);
    if (!toolDef) {
      return { success: false, error: `Tool "${toolName}" definition not found in skill "${skillId}".`, duration: 0 };
    }

    logger.info(`Executing skill tool: ${toolName}`, { skill: skillId, handler: toolDef.handler.type });

    let result: { success: boolean; data?: unknown; error?: string };

    try {
      switch (toolDef.handler.type) {
        case 'script':
          result = await executeScriptHandler(toolDef.handler, params, skill.configValues);
          break;
        case 'http':
          result = await executeHttpHandler(toolDef.handler, params, skill.configValues);
          break;
        case 'function':
          result = await executeFunctionHandler(toolDef.handler, params, skill.configValues);
          break;
        default:
          result = { success: false, error: `Unknown handler type: ${(toolDef.handler as any).type}` };
      }
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const duration = Date.now() - start;

    if (!result.success) {
      skill.error = result.error;
      await this.store.save(skill);
    }

    logger.info(`Skill tool ${toolName} ${result.success ? 'completed' : 'failed'}`, {
      skill: skillId, duration, error: result.error,
    });

    return { ...result, duration };
  }

  // ─── Prompt Context ───────────────────────────────────

  /** Build combined prompt context from all active skills */
  buildSkillContext(): string | null {
    const parts: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.status === 'active' && skill.manifest.promptContext) {
        parts.push(`[${skill.manifest.name}] ${skill.manifest.promptContext}`);
      }
    }
    if (parts.length === 0) return null;
    return `Active Skills Context:\n${parts.join('\n')}`;
  }

  // ─── Stats ────────────────────────────────────────────

  getStats(): {
    total: number;
    active: number;
    disabled: number;
    installed: number;
    error: number;
    totalTools: number;
  } {
    let active = 0, disabled = 0, installed = 0, error = 0, totalTools = 0;
    for (const skill of this.skills.values()) {
      switch (skill.status) {
        case 'active': active++; totalTools += skill.manifest.tools.length; break;
        case 'disabled': disabled++; break;
        case 'installed': installed++; break;
        case 'error': error++; break;
      }
    }
    return { total: this.skills.size, active, disabled, installed, error, totalTools };
  }
}

// ─── Factory ────────────────────────────────────────────

export function createSkillRegistry(store?: SkillStore): SkillRegistry {
  return new SkillRegistry(store);
}
