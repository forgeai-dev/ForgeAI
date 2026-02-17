import { resolve, join, relative, dirname } from 'node:path';
import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.dll', '.sys', '.com', '.msi'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export class FileManagerTool extends BaseTool {
  private sandboxRoot: string;

  readonly definition: ToolDefinition = {
    name: 'file_manager',
    description: 'Read, write, list, and delete files within a sandboxed directory. Cannot access files outside the sandbox or create executable files.',
    category: 'file',
    dangerous: true,
    parameters: [
      { name: 'action', type: 'string', description: 'Action: "read", "write", "list", "delete", "exists", "info"', required: true },
      { name: 'path', type: 'string', description: 'Relative file path within sandbox', required: true },
      { name: 'content', type: 'string', description: 'File content (for write action)', required: false },
      { name: 'encoding', type: 'string', description: 'File encoding (default: utf-8)', required: false, default: 'utf-8' },
    ],
  };

  constructor(sandboxRoot?: string) {
    super();
    this.sandboxRoot = sandboxRoot || resolve(process.cwd(), '.forgeai', 'workspace');
    if (!existsSync(this.sandboxRoot)) {
      mkdir(this.sandboxRoot, { recursive: true }).catch(() => {});
    }
  }

  private resolveSafe(filePath: string): string | null {
    const resolved = resolve(this.sandboxRoot, filePath);
    const rel = relative(this.sandboxRoot, resolved);
    // Prevent path traversal
    if (rel.startsWith('..') || resolve(resolved) !== resolved.replace(/[/\\]+$/, '')) {
      return null;
    }
    return resolved;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    const action = String(params['action']);
    const filePath = String(params['path']);
    const content = params['content'] as string | undefined;
    const encoding = (params['encoding'] as BufferEncoding) || 'utf-8';

    const safePath = this.resolveSafe(filePath);
    if (!safePath) {
      return { success: false, error: 'Path traversal blocked — paths must stay within sandbox', duration: 0 };
    }

    // Block dangerous extensions for writes
    if (action === 'write') {
      const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        return { success: false, error: `Blocked: cannot create ${ext} files`, duration: 0 };
      }
    }

    const { result, duration } = await this.timed(async () => {
      switch (action) {
        case 'read': {
          const stats = await stat(safePath);
          if (stats.size > MAX_FILE_SIZE) {
            throw new Error(`File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`);
          }
          const data = await readFile(safePath, encoding);
          return { content: data, size: stats.size, path: filePath };
        }

        case 'write': {
          if (content === undefined) throw new Error('Content is required for write');
          await mkdir(dirname(safePath), { recursive: true });
          await writeFile(safePath, content, encoding);
          return { written: true, path: filePath, size: Buffer.byteLength(content, encoding) };
        }

        case 'list': {
          const entries = await readdir(safePath, { withFileTypes: true });
          const items = await Promise.all(
            entries.map(async (e) => {
              const entryPath = join(safePath, e.name);
              try {
                const s = await stat(entryPath);
                return {
                  name: e.name,
                  type: e.isDirectory() ? 'directory' : 'file',
                  size: s.size,
                  modified: s.mtime.toISOString(),
                };
              } catch {
                return { name: e.name, type: e.isDirectory() ? 'directory' : 'file' };
              }
            })
          );
          return { path: filePath, count: items.length, items };
        }

        case 'delete': {
          await unlink(safePath);
          return { deleted: true, path: filePath };
        }

        case 'exists': {
          return { exists: existsSync(safePath), path: filePath };
        }

        case 'info': {
          const s = await stat(safePath);
          return {
            path: filePath,
            size: s.size,
            isFile: s.isFile(),
            isDirectory: s.isDirectory(),
            created: s.birthtime.toISOString(),
            modified: s.mtime.toISOString(),
          };
        }

        default:
          throw new Error(`Unknown action: ${action}. Use read, write, list, delete, exists, info`);
      }
    });

    this.logger.debug('File operation', { action, path: filePath, duration });
    return { success: true, data: result, duration };
  }

  getSandboxRoot(): string {
    return this.sandboxRoot;
  }
}
