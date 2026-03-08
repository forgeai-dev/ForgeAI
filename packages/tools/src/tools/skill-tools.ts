import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tool:Skill');

// ─── Minimal interface to avoid circular dependency with SkillRegistry ───

interface SkillRegistryRef {
  install(manifest: unknown, config?: Record<string, unknown>): Promise<{ success: boolean; error?: string; skill?: unknown }>;
  uninstall(skillId: string): Promise<{ success: boolean; error?: string }>;
  activate(skillId: string): Promise<{ success: boolean; error?: string }>;
  deactivate(skillId: string): Promise<{ success: boolean; error?: string }>;
  listSkills(): Promise<Array<{
    manifest: { id: string; name: string; version: string; description: string; category: string; tools: Array<{ name: string }>; promptContext?: string };
    status: string;
    installedAt: number;
    activatedAt?: number;
    error?: string;
  }>>;
  getSkill(id: string): Promise<{
    manifest: { id: string; name: string; tools: Array<{ name: string }> };
    status: string;
  } | null>;
  getStats(): { total: number; active: number; disabled: number; installed: number; error: number; totalTools: number };
  initialize(): Promise<void>;
}

// ─── Global Ref (set by gateway) ────────────────────────

let skillRegistryRef: SkillRegistryRef | null = null;

/**
 * Set the skill registry reference. Called by gateway at startup.
 */
export function setSkillRegistryRef(ref: SkillRegistryRef): void {
  skillRegistryRef = ref;
  logger.info('Skill registry ref set');
}

// ─── skill_list ─────────────────────────────────────────

export class SkillListTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'skill_list',
    description: 'List all installed skills with their status, tools, and configuration. Shows which skills are active, installed, or disabled.',
    category: 'utility',
    parameters: [
      {
        name: 'filter',
        type: 'string',
        description: 'Filter by status: "all", "active", "installed", "disabled". Default: "all".',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!skillRegistryRef) {
      return { success: false, error: 'Skill registry not initialized.', duration: 0 };
    }

    const start = Date.now();
    const filter = (params.filter as string) || 'all';

    try {
      let skills = await skillRegistryRef.listSkills();

      if (filter !== 'all') {
        skills = skills.filter(s => s.status === filter);
      }

      const stats = skillRegistryRef.getStats();
      const summary = skills.map(s => ({
        id: s.manifest.id,
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description,
        category: s.manifest.category,
        status: s.status,
        tools: s.manifest.tools.map(t => t.name),
        installedAt: new Date(s.installedAt).toISOString(),
        activatedAt: s.activatedAt ? new Date(s.activatedAt).toISOString() : null,
        error: s.error,
      }));

      return {
        success: true,
        data: { skills: summary, stats },
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
    }
  }
}

// ─── skill_install ──────────────────────────────────────

export class SkillInstallTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'skill_install',
    description: `Install a skill from a JSON manifest. The manifest must include: id (lowercase with hyphens/underscores), name, version (semver), description, category (productivity|development|data|communication|automation|analysis|integration|custom), and tools array. Each tool needs: name, description, parameters (JSON Schema object), handler {type: "script"|"http"|"function", value: "template/url/code"}. Use skill_activate after installing to enable it.`,
    category: 'utility',
    parameters: [
      {
        name: 'manifest',
        type: 'string',
        description: 'JSON string of the skill manifest.',
        required: true,
      },
      {
        name: 'config',
        type: 'string',
        description: 'Optional JSON string of config values for the skill.',
        required: false,
      },
      {
        name: 'activate',
        type: 'boolean',
        description: 'Auto-activate the skill after installation. Default: false.',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!skillRegistryRef) {
      return { success: false, error: 'Skill registry not initialized.', duration: 0 };
    }

    const start = Date.now();

    try {
      let manifest: unknown;
      try {
        manifest = typeof params.manifest === 'string' ? JSON.parse(params.manifest) : params.manifest;
      } catch {
        return { success: false, error: 'Invalid manifest JSON.', duration: Date.now() - start };
      }

      let config: Record<string, unknown> | undefined;
      if (params.config) {
        try {
          config = typeof params.config === 'string' ? JSON.parse(params.config as string) : params.config as Record<string, unknown>;
        } catch {
          return { success: false, error: 'Invalid config JSON.', duration: Date.now() - start };
        }
      }

      const result = await skillRegistryRef.install(manifest, config);
      if (!result.success) {
        return { success: false, error: result.error, duration: Date.now() - start };
      }

      // Auto-activate if requested
      if (params.activate) {
        const m = manifest as { id: string; name: string; tools?: Array<{ name: string }> };
        const activateResult = await skillRegistryRef.activate(m.id);
        if (!activateResult.success) {
          return {
            success: true,
            data: {
              message: `Skill "${m.name}" installed but activation failed: ${activateResult.error}`,
              activated: false,
            },
            duration: Date.now() - start,
          };
        }
        return {
          success: true,
          data: {
            message: `Skill "${m.name}" installed and activated successfully.`,
            activated: true,
            tools: m.tools?.map(t => t.name) ?? [],
          },
          duration: Date.now() - start,
        };
      }

      const m = manifest as { name: string };
      return {
        success: true,
        data: {
          message: `Skill "${m.name}" installed. Use skill_activate to enable it.`,
          activated: false,
        },
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
    }
  }
}

// ─── skill_activate ─────────────────────────────────────

export class SkillActivateTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'skill_activate',
    description: 'Activate an installed skill. Once active, its tools become available and its prompt context is injected into the system prompt.',
    category: 'utility',
    parameters: [
      {
        name: 'skill_id',
        type: 'string',
        description: 'The ID of the skill to activate.',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!skillRegistryRef) {
      return { success: false, error: 'Skill registry not initialized.', duration: 0 };
    }

    const start = Date.now();
    const skillId = params.skill_id as string;

    if (!skillId) {
      return { success: false, error: 'skill_id is required.', duration: 0 };
    }

    try {
      const result = await skillRegistryRef.activate(skillId);
      if (!result.success) {
        return { success: false, error: result.error, duration: Date.now() - start };
      }

      const skill = await skillRegistryRef.getSkill(skillId);
      return {
        success: true,
        data: {
          message: `Skill "${skillId}" activated. Tools now available: ${skill?.manifest.tools.map(t => t.name).join(', ')}`,
          tools: skill?.manifest.tools.map(t => t.name) ?? [],
        },
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
    }
  }
}

// ─── skill_deactivate ───────────────────────────────────

export class SkillDeactivateTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'skill_deactivate',
    description: 'Deactivate an active skill. Its tools will no longer be available and its prompt context will be removed from the system prompt.',
    category: 'utility',
    parameters: [
      {
        name: 'skill_id',
        type: 'string',
        description: 'The ID of the skill to deactivate.',
        required: true,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!skillRegistryRef) {
      return { success: false, error: 'Skill registry not initialized.', duration: 0 };
    }

    const start = Date.now();
    const skillId = params.skill_id as string;

    if (!skillId) {
      return { success: false, error: 'skill_id is required.', duration: 0 };
    }

    try {
      const result = await skillRegistryRef.deactivate(skillId);
      if (!result.success) {
        return { success: false, error: result.error, duration: Date.now() - start };
      }

      return {
        success: true,
        data: { message: `Skill "${skillId}" deactivated.` },
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
    }
  }
}

// ─── skill_create ───────────────────────────────────────

export class SkillCreateTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'skill_create',
    description: `Create and auto-activate a new skill. Shortcut for skill_install + skill_activate. Perfect for creating custom API integrations, automation scripts, or data processing tools on-the-fly. Handler types: "script" (shell command with {{param}} placeholders), "http" (URL template with method/headers), "function" (JS code that receives params, config, fetch).`,
    category: 'utility',
    parameters: [
      {
        name: 'id',
        type: 'string',
        description: 'Unique skill ID (3-50 lowercase alphanumeric, hyphens, underscores). E.g., "weather-api", "jira_tracker".',
        required: true,
      },
      {
        name: 'name',
        type: 'string',
        description: 'Display name for the skill. E.g., "Weather API", "Jira Tracker".',
        required: true,
      },
      {
        name: 'description',
        type: 'string',
        description: 'What the skill does (min 10 chars).',
        required: true,
      },
      {
        name: 'category',
        type: 'string',
        description: 'Category: productivity, development, data, communication, automation, analysis, integration, custom.',
        required: true,
      },
      {
        name: 'tools',
        type: 'string',
        description: 'JSON array of tool definitions. Each: { name, description, parameters: { type: "object", properties: {...}, required: [...] }, handler: { type: "script"|"http"|"function", value: "...", method?: "GET"|"POST", headers?: {...} } }',
        required: true,
      },
      {
        name: 'prompt_context',
        type: 'string',
        description: 'Optional context injected into system prompt when skill is active.',
        required: false,
      },
      {
        name: 'config',
        type: 'string',
        description: 'Optional JSON of config values: { "key": "value" }.',
        required: false,
      },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!skillRegistryRef) {
      return { success: false, error: 'Skill registry not initialized.', duration: 0 };
    }

    const start = Date.now();

    try {
      let tools: unknown[];
      try {
        tools = typeof params.tools === 'string' ? JSON.parse(params.tools as string) : params.tools as unknown[];
      } catch {
        return { success: false, error: 'Invalid tools JSON.', duration: Date.now() - start };
      }

      const manifest = {
        id: params.id as string,
        name: params.name as string,
        version: '1.0.0',
        description: params.description as string,
        category: params.category as string,
        tools,
        promptContext: params.prompt_context as string | undefined,
      };

      let config: Record<string, unknown> | undefined;
      if (params.config) {
        try {
          config = typeof params.config === 'string' ? JSON.parse(params.config as string) : params.config as Record<string, unknown>;
        } catch {
          return { success: false, error: 'Invalid config JSON.', duration: Date.now() - start };
        }
      }

      // Install
      const installResult = await skillRegistryRef.install(manifest, config);
      if (!installResult.success) {
        return { success: false, error: installResult.error, duration: Date.now() - start };
      }

      // Auto-activate
      const activateResult = await skillRegistryRef.activate(manifest.id);
      if (!activateResult.success) {
        return {
          success: true,
          data: {
            message: `Skill "${manifest.name}" created but activation failed: ${activateResult.error}`,
            activated: false,
          },
          duration: Date.now() - start,
        };
      }

      const toolNames = (tools as Array<{ name: string }>).map(t => t.name);
      return {
        success: true,
        data: {
          message: `Skill "${manifest.name}" created and activated! New tools available: ${toolNames.join(', ')}`,
          skillId: manifest.id,
          activated: true,
          tools: toolNames,
        },
        duration: Date.now() - start,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
    }
  }
}
