import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Tool:ProjectDelete');

// ─── Minimal interfaces to avoid circular deps ──────────

interface AppRegistryRef {
  delete(name: string): boolean;
  has(name: string): boolean;
  get(name: string): { port: number; name: string } | undefined;
  entries(): IterableIterator<[string, { port: number; name: string }]>;
}

interface AppManagerRef {
  stopApp(name: string): { success: boolean };
  removeApp(name: string): boolean;
}

interface VaultRef {
  isInitialized(): boolean;
  set(key: string, value: string): void;
}

interface ProjectDeleteRefs {
  appRegistry: AppRegistryRef;
  appManager: AppManagerRef | null;
  vault: VaultRef | null;
  workspaceRoot: string;
}

// ─── Global Ref (set by gateway) ─────────────────────────

let refs: ProjectDeleteRefs | null = null;

export function setProjectDeleteRefs(r: ProjectDeleteRefs): void {
  refs = r;
  logger.info('ProjectDelete refs set');
}

// ─── Tool ────────────────────────────────────────────────

export class ProjectDeleteTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'project_delete',
    description: `Completely delete a project/app: stops the running process, removes from app registry (so the URL stops working), and deletes all project files from workspace.
Use this instead of manually deleting files when you want to fully remove an app created by the agent.
You can identify the app by name (e.g. "war-monitor") or by port number.`,
    category: 'file',
    dangerous: true,
    parameters: [
      { name: 'name', type: 'string', description: 'App name as registered (e.g. "war-monitor"). Use this OR port.', required: false },
      { name: 'port', type: 'number', description: 'App port number (e.g. 3456). Use this OR name.', required: false },
      { name: 'delete_files', type: 'boolean', description: 'Whether to also delete project files from workspace (default: true)', required: false },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    if (!refs) {
      return { success: false, error: 'ProjectDelete not initialized — refs not set', duration: 0 };
    }

    const nameParam = params['name'] ? String(params['name']).trim().toLowerCase() : null;
    const portParam = params['port'] ? Number(params['port']) : null;
    const deleteFiles = params['delete_files'] !== false; // default true

    if (!nameParam && !portParam) {
      return { success: false, error: 'Either "name" or "port" is required', duration: 0 };
    }

    const { result, duration } = await this.timed(async () => {
      const actions: string[] = [];

      // Resolve app name from port if needed
      let appName = nameParam;
      let appPort = portParam;

      if (!appName && appPort) {
        for (const [name, info] of refs!.appRegistry.entries()) {
          if (info.port === appPort) {
            appName = name;
            break;
          }
        }
      }

      if (appName) {
        const registryEntry = refs!.appRegistry.get(appName);
        if (registryEntry) {
          appPort = registryEntry.port;
        }
      }

      // 1. Stop managed process
      if (appName && refs!.appManager) {
        try {
          refs!.appManager.removeApp(appName);
          actions.push(`Process stopped and removed: ${appName}`);
        } catch (e) {
          actions.push(`Process stop attempted: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 2. Kill any process on the port (fallback)
      if (appPort) {
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);

          const isLinux = process.platform !== 'win32';
          if (isLinux) {
            try {
              await execFileAsync('fuser', ['-k', `${appPort}/tcp`], { timeout: 5000 });
              actions.push(`Killed process on port ${appPort} (fuser)`);
            } catch {
              // Try lsof + kill as fallback
              try {
                const { stdout } = await execFileAsync('lsof', ['-ti', `:${appPort}`], { timeout: 5000 });
                const pids = stdout.trim().split('\n').filter(Boolean);
                for (const pid of pids) {
                  try { await execFileAsync('kill', ['-9', pid], { timeout: 3000 }); } catch { /* ignore */ }
                }
                if (pids.length) actions.push(`Killed PIDs on port ${appPort}: ${pids.join(', ')}`);
              } catch { /* no process on port */ }
            }
          }
        } catch (e) {
          actions.push(`Port kill attempted: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 3. Remove from app registry
      if (appName && refs!.appRegistry.has(appName)) {
        refs!.appRegistry.delete(appName);
        actions.push(`Removed from app registry: ${appName}`);

        // Persist updated registry to vault
        if (refs!.vault?.isInitialized()) {
          const registryData = JSON.stringify(Array.from(refs!.appRegistry.entries()));
          refs!.vault.set('config:app_registry', registryData);
          actions.push('Registry persisted to vault');
        }
      } else {
        actions.push(`App "${appName || appPort}" not found in registry (may already be removed)`);
      }

      // 4. Delete project files
      if (deleteFiles && appName) {
        const projectDir = resolve(refs!.workspaceRoot, appName);
        if (existsSync(projectDir)) {
          await rm(projectDir, { recursive: true, force: true });
          actions.push(`Deleted project directory: ${projectDir}`);
        } else {
          // Also try with port-based directory name
          if (appPort) {
            const portDir = resolve(refs!.workspaceRoot, String(appPort));
            if (existsSync(portDir)) {
              await rm(portDir, { recursive: true, force: true });
              actions.push(`Deleted project directory: ${portDir}`);
            }
          }
          actions.push(`Project directory not found at: ${projectDir}`);
        }
      }

      logger.info('Project deleted', { appName, appPort, actions });
      return { deleted: true, name: appName, port: appPort, actions };
    });

    return { success: true, data: result, duration };
  }
}
