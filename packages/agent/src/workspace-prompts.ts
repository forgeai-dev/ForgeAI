import { createLogger } from '@forgeai/shared';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const logger = createLogger('Agent:WorkspacePrompts');

// ─── Prompt file definitions ────────────────────────────
interface PromptFile {
  filename: string;
  label: string;
  defaultContent: string;
}

const PROMPT_FILES: PromptFile[] = [
  {
    filename: 'AGENTS.md',
    label: 'Agent Behavior',
    defaultContent: `# Agent Behavior Guide

Define how the agent should behave, what approach to take, and any specific instructions.

## General Rules
- Be helpful and concise
- Always verify before making destructive changes
- Present results clearly with relevant URLs, paths, and details

## Task Approach
- For multi-step tasks, present a brief plan first
- Execute step by step, checking results after each step
- If something fails twice, stop and ask the user
`,
  },
  {
    filename: 'SOUL.md',
    label: 'Agent Personality',
    defaultContent: `# Agent Soul / Personality

Define the personality, tone, and communication style of the agent.

## Personality
- Friendly but professional
- Direct and to the point
- Uses the same language as the user

## Communication Style
- Match the user's language (pt-BR, en, etc.)
- Be concise — avoid unnecessary verbosity
- Use emoji sparingly and only when appropriate
`,
  },
  {
    filename: 'IDENTITY.md',
    label: 'Agent Identity',
    defaultContent: `# Agent Identity

Define who the agent is — name, role, and context.

## Identity
- Name: ForgeAI
- Role: Personal AI Assistant
- Creator: You (the user)

## Context
- Running on your personal machine
- Has access to tools: shell, browser, file manager, desktop control
- Can automate tasks, create projects, manage files, and more
`,
  },
  {
    filename: 'USER.md',
    label: 'User Preferences',
    defaultContent: `# User Preferences

Tell the agent about yourself — preferences, projects, tech stack, etc.

## About Me
- (Add your name, role, preferences here)

## Tech Stack
- (Add your preferred languages, frameworks, tools)

## Projects
- (Add info about your current projects)
`,
  },
];

// ─── Workspace Prompts Loader ────────────────────────────

export interface WorkspacePromptsConfig {
  workspacePath?: string;
}

export interface LoadedPrompts {
  content: string;
  files: { filename: string; label: string; loaded: boolean; chars: number }[];
}

/**
 * Load workspace prompt files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md)
 * from the workspace directory. Creates templates if they don't exist.
 */
export function loadWorkspacePrompts(config?: WorkspacePromptsConfig): LoadedPrompts {
  const workspacePath = config?.workspacePath ?? resolve(process.cwd(), '.forgeai', 'workspace');

  // Ensure workspace exists
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
  }

  const parts: string[] = [];
  const files: LoadedPrompts['files'] = [];

  for (const promptFile of PROMPT_FILES) {
    const filePath = join(workspacePath, promptFile.filename);

    // Create template if file doesn't exist
    if (!existsSync(filePath)) {
      try {
        writeFileSync(filePath, promptFile.defaultContent, 'utf-8');
        logger.info(`Created template: ${promptFile.filename}`);
      } catch (err) {
        logger.warn(`Failed to create template ${promptFile.filename}`, err as Record<string, unknown>);
      }
    }

    // Read file content
    try {
      const content = readFileSync(filePath, 'utf-8').trim();

      // Skip files that are still just the default template (user hasn't customized)
      const isDefault = content === promptFile.defaultContent.trim();
      if (isDefault) {
        files.push({ filename: promptFile.filename, label: promptFile.label, loaded: false, chars: 0 });
        continue;
      }

      // Skip empty files
      if (content.length === 0) {
        files.push({ filename: promptFile.filename, label: promptFile.label, loaded: false, chars: 0 });
        continue;
      }

      // Cap content to avoid bloating the system prompt
      const maxChars = 4000;
      const trimmed = content.length > maxChars
        ? content.substring(0, maxChars) + '\n... (truncated)'
        : content;

      parts.push(`--- ${promptFile.label} (${promptFile.filename}) ---\n${trimmed}`);
      files.push({ filename: promptFile.filename, label: promptFile.label, loaded: true, chars: trimmed.length });

      logger.debug(`Loaded workspace prompt: ${promptFile.filename} (${trimmed.length} chars)`);
    } catch (err) {
      files.push({ filename: promptFile.filename, label: promptFile.label, loaded: false, chars: 0 });
      logger.warn(`Failed to read ${promptFile.filename}`, err as Record<string, unknown>);
    }
  }

  return {
    content: parts.length > 0 ? '\n\n' + parts.join('\n\n') : '',
    files,
  };
}

/**
 * Get the list of workspace prompt file definitions (for API/dashboard).
 */
export function getWorkspacePromptFiles(): { filename: string; label: string }[] {
  return PROMPT_FILES.map(f => ({ filename: f.filename, label: f.label }));
}
