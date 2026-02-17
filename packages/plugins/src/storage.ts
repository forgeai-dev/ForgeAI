import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PluginStorage } from './types.js';

export class FilePluginStorage implements PluginStorage {
  private data: Record<string, unknown> = {};
  private filePath: string;
  private loaded = false;

  constructor(pluginId: string, basePath?: string) {
    const base = basePath || resolve(process.cwd(), '.forgeai', 'plugins');
    this.filePath = join(base, `${pluginId}.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const dir = resolve(this.filePath, '..');
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    if (existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(await readFile(this.filePath, 'utf-8'));
      } catch {
        this.data = {};
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async get(key: string): Promise<unknown | null> {
    await this.ensureLoaded();
    return this.data[key] ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ensureLoaded();
    this.data[key] = value;
    await this.save();
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    delete this.data[key];
    await this.save();
  }

  async list(): Promise<string[]> {
    await this.ensureLoaded();
    return Object.keys(this.data);
  }
}
