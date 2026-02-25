import { resolve, join, dirname, basename } from 'node:path';
import { readFile, writeFile, readdir, stat, mkdir, unlink, rm, rename, copyFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const IS_WINDOWS = process.platform === 'win32';

// ─── OS-critical paths: block destructive operations (delete/write) ───
// The agent CAN read these paths for inspection, but cannot delete or overwrite them.
const PROTECTED_PATHS_WINDOWS = [
  /^c:\\windows$/i,
  /^c:\\windows\\/i,
  /^c:\\boot$/i,
  /^c:\\boot\\/i,
  /^c:\\recovery$/i,
  /^c:\\recovery\\/i,
  /^c:\\efi$/i,
  /^c:\\efi\\/i,
  /^c:\\\$recycle\.bin/i,
  /^c:\\system volume information/i,
];
const PROTECTED_PATHS_LINUX = [
  /^\/boot\//,
  /^\/sbin\//,
  /^\/bin\//,
  /^\/lib\//,
  /^\/lib64\//,
  /^\/usr\/bin\//,
  /^\/usr\/sbin\//,
  /^\/usr\/lib\//,
  /^\/proc\//,
  /^\/sys\//,
];

function isProtectedPath(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, '\\');
  const patterns = IS_WINDOWS ? PROTECTED_PATHS_WINDOWS : PROTECTED_PATHS_LINUX;
  return patterns.some(p => p.test(normalized));
}

export class FileManagerTool extends BaseTool {
  private workspaceRoot: string;

  readonly definition: ToolDefinition = {
    name: 'file_manager',
    description: `Full system file manager with read, write, list, delete, copy, move, search, permissions, and disk info.
Supports BOTH relative paths (resolved from workspace) and absolute paths (full system access).
Absolute paths: "/etc/nginx/nginx.conf" (Linux), "C:\\Users\\file.txt" (Windows).
Relative paths: "project/index.html" (resolved from .forgeai/workspace/).
On Linux with root: can access and modify ANY file on the system (/etc, /var, /root, etc.).
On Windows: silent operations without opening any visible window.`,
    category: 'file',
    dangerous: true,
    parameters: [
      { name: 'action', type: 'string', description: 'Action: "read", "write", "list", "delete", "exists", "info", "copy", "move", "search", "permissions", "disk_info", "mkdir"', required: true },
      { name: 'path', type: 'string', description: 'File/directory path. Absolute paths (starting with / or C:\\) access anywhere on the system. Relative paths resolve from workspace.', required: true },
      { name: 'content', type: 'string', description: 'File content (for write action)', required: false },
      { name: 'dest', type: 'string', description: 'Destination path (for copy/move actions)', required: false },
      { name: 'pattern', type: 'string', description: 'Search pattern/glob (for search action)', required: false },
      { name: 'mode', type: 'string', description: 'Permission mode e.g. "755" (for permissions action, Linux only)', required: false },
      { name: 'encoding', type: 'string', description: 'File encoding (default: utf-8)', required: false, default: 'utf-8' },
    ],
  };

  constructor(workspaceRoot?: string) {
    super();
    this.workspaceRoot = workspaceRoot || resolve(process.cwd(), '.forgeai', 'workspace');
    if (!existsSync(this.workspaceRoot)) {
      mkdir(this.workspaceRoot, { recursive: true }).catch(() => {});
    }
  }

  private resolvePath(filePath: string): string {
    // Absolute paths: allow full system access
    if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
      return resolve(filePath);
    }
    // Relative paths: resolve from workspace
    return resolve(this.workspaceRoot, filePath);
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const action = String(params['action']);
    const filePath = String(params['path']);
    const content = params['content'] as string | undefined;
    const dest = params['dest'] ? String(params['dest']) : '';
    const pattern = params['pattern'] ? String(params['pattern']) : '';
    const mode = params['mode'] ? String(params['mode']) : '';
    const encoding = (params['encoding'] as BufferEncoding) || 'utf-8';

    const targetPath = this.resolvePath(filePath);

    // ─── OS Protection: block destructive ops on critical system paths ───
    const DESTRUCTIVE_ACTIONS = ['write', 'delete', 'move', 'permissions'];
    if (DESTRUCTIVE_ACTIONS.includes(action) && isProtectedPath(targetPath)) {
      return {
        success: false,
        error: `🛡️ BLOCKED: Cannot ${action} on OS-critical path "${targetPath}". System files are protected from modification. You can still READ this path for inspection.`,
        duration: 0,
      };
    }

    try {
      const { result, duration } = await this.timed(async () => {
        switch (action) {
          case 'read': {
            const stats = await stat(targetPath);
            if (stats.size > MAX_FILE_SIZE) {
              throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
            }
            const data = await readFile(targetPath, encoding);
            return { content: data, size: stats.size, path: targetPath };
          }

          case 'write': {
            if (content === undefined) throw new Error('Content is required for write');
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, content, encoding);
            return { written: true, path: targetPath, size: Buffer.byteLength(content, encoding) };
          }

          case 'list': {
            const entries = await readdir(targetPath, { withFileTypes: true });
            const items = await Promise.all(
              entries.map(async (e) => {
                const entryPath = join(targetPath, e.name);
                try {
                  const s = await stat(entryPath);
                  return {
                    name: e.name,
                    type: e.isDirectory() ? 'directory' : 'file',
                    size: s.size,
                    modified: s.mtime.toISOString(),
                    permissions: !IS_WINDOWS ? (s.mode & 0o777).toString(8) : undefined,
                  };
                } catch {
                  return { name: e.name, type: e.isDirectory() ? 'directory' : 'file' };
                }
              })
            );
            return { path: targetPath, count: items.length, items };
          }

          case 'delete': {
            const s = await stat(targetPath);
            if (s.isDirectory()) {
              await rm(targetPath, { recursive: true, force: true });
            } else {
              await unlink(targetPath);
            }
            return { deleted: true, path: targetPath, type: s.isDirectory() ? 'directory' : 'file' };
          }

          case 'exists': {
            return { exists: existsSync(targetPath), path: targetPath };
          }

          case 'info': {
            const s = await stat(targetPath);
            return {
              path: targetPath,
              size: s.size,
              isFile: s.isFile(),
              isDirectory: s.isDirectory(),
              created: s.birthtime.toISOString(),
              modified: s.mtime.toISOString(),
              permissions: !IS_WINDOWS ? (s.mode & 0o777).toString(8) : undefined,
              owner: !IS_WINDOWS ? { uid: s.uid, gid: s.gid } : undefined,
            };
          }

          case 'mkdir': {
            await mkdir(targetPath, { recursive: true });
            return { created: true, path: targetPath };
          }

          case 'copy': {
            if (!dest) throw new Error('Parameter "dest" is required for copy');
            const destPath = this.resolvePath(dest);
            await mkdir(dirname(destPath), { recursive: true });
            await copyFile(targetPath, destPath);
            return { copied: true, from: targetPath, to: destPath };
          }

          case 'move': {
            if (!dest) throw new Error('Parameter "dest" is required for move');
            const moveDest = this.resolvePath(dest);
            await mkdir(dirname(moveDest), { recursive: true });
            await rename(targetPath, moveDest);
            return { moved: true, from: targetPath, to: moveDest };
          }

          case 'search': {
            const searchPattern = pattern || basename(filePath);
            const searchDir = existsSync(targetPath) && (await stat(targetPath)).isDirectory() ? targetPath : dirname(targetPath);
            const results: Array<{ name: string; path: string; type: string }> = [];
            const searchRecursive = async (dir: string, depth: number) => {
              if (depth > 5 || results.length >= 50) return;
              try {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const e of entries) {
                  if (results.length >= 50) break;
                  const fullPath = join(dir, e.name);
                  if (e.name.toLowerCase().includes(searchPattern.toLowerCase())) {
                    results.push({ name: e.name, path: fullPath, type: e.isDirectory() ? 'directory' : 'file' });
                  }
                  if (e.isDirectory() && !e.name.startsWith('.')) {
                    await searchRecursive(fullPath, depth + 1);
                  }
                }
              } catch { /* permission denied, skip */ }
            };
            await searchRecursive(searchDir, 0);
            return { pattern: searchPattern, searchDir, count: results.length, results };
          }

          case 'permissions': {
            if (IS_WINDOWS) throw new Error('chmod not available on Windows');
            if (!mode) throw new Error('Parameter "mode" is required for permissions (e.g. "755")');
            await chmod(targetPath, parseInt(mode, 8));
            return { path: targetPath, mode, applied: true };
          }

          case 'disk_info': {
            const { execFile: execFileCb } = await import('node:child_process');
            const output = await new Promise<string>((res, rej) => {
              const cmd = IS_WINDOWS ? 'powershell.exe' : 'df';
              const args = IS_WINDOWS
                ? ['-NoProfile', '-Command', 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N="UsedGB";E={[math]::Round($_.Used/1GB,2)}}, @{N="FreeGB";E={[math]::Round($_.Free/1GB,2)}} | ConvertTo-Json']
                : ['-h', targetPath];
              execFileCb(cmd, args, { timeout: 10_000 }, (err, stdout) => err && !stdout ? rej(err) : res(stdout));
            });
            return { disk: output.trim(), path: targetPath };
          }

          default:
            throw new Error(`Unknown action: ${action}. Use: read, write, list, delete, exists, info, mkdir, copy, move, search, permissions, disk_info`);
        }
      });

      this.logger.debug('File operation', { action, path: targetPath, duration });
      return { success: true, data: result, duration };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, duration: 0 };
    }
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
