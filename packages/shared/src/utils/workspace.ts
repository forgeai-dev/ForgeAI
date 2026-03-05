import { resolve, normalize } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, cpSync, writeFileSync } from 'node:fs';

let migrationDone = false;

/**
 * Resolve the ForgeAI workspace root directory.
 *
 * Priority:
 * 1. FORGEAI_WORKSPACE env var (explicit override)
 * 2. <FORGEAI_HOME>/workspace (derived from data root)
 *
 * On Linux/VPS: /root/.forgeai/workspace
 * On Windows:   C:\Users\<user>\.forgeai\workspace
 *
 * The directory is created automatically if it doesn't exist.
 */
export function resolveWorkspaceRoot(): string {
  if (process.env['FORGEAI_WORKSPACE']) {
    const custom = resolve(process.env['FORGEAI_WORKSPACE']);
    ensureDir(custom);
    return custom;
  }

  const workspace = resolve(resolveForgeAIRoot(), 'workspace');
  ensureDir(workspace);
  return workspace;
}

/**
 * Resolve the ForgeAI data root directory (~/.forgeai).
 * Used for config, vault, screenshots, etc.
 *
 * On first call, checks if data needs to be migrated from the legacy
 * location (process.cwd()/.forgeai) to the new home-based location.
 */
export function resolveForgeAIRoot(): string {
  if (process.env['FORGEAI_HOME']) {
    const custom = resolve(process.env['FORGEAI_HOME']);
    ensureDir(custom);
    return custom;
  }

  const home = homedir();
  const forgeaiRoot = resolve(home, '.forgeai');
  ensureDir(forgeaiRoot);

  // Auto-migrate from legacy location (process.cwd()/.forgeai) if needed
  if (!migrationDone) {
    migrationDone = true;
    migrateFromLegacy(forgeaiRoot);
  }

  return forgeaiRoot;
}

/**
 * One-time migration: if the new ~/.forgeai has no vault but the old
 * process.cwd()/.forgeai does, copy all data over.
 */
function migrateFromLegacy(newRoot: string): void {
  try {
    const legacyRoot = resolve(process.cwd(), '.forgeai');

    // Skip if same path (no migration needed)
    if (normalize(legacyRoot) === normalize(newRoot)) return;

    // Skip if legacy location doesn't exist
    if (!existsSync(legacyRoot)) return;

    // Skip if legacy has no vault (nothing to migrate)
    const legacyVault = resolve(legacyRoot, 'vault.json');
    if (!existsSync(legacyVault)) return;

    // Skip if new location already has a vault (already migrated or fresh setup done)
    const newVault = resolve(newRoot, 'vault.json');
    if (existsSync(newVault)) return;

    // Skip if migration marker exists (already attempted)
    const marker = resolve(newRoot, '.migrated-from-legacy');
    if (existsSync(marker)) return;

    // Perform migration: copy everything from legacy to new
    console.log(`[ForgeAI] Migrating data from ${legacyRoot} → ${newRoot}`);
    cpSync(legacyRoot, newRoot, { recursive: true, force: false });

    // Write marker so we don't attempt again
    writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      from: legacyRoot,
      to: newRoot,
    }, null, 2));

    console.log(`[ForgeAI] Migration complete. Data now at ${newRoot}`);
  } catch (err) {
    console.warn('[ForgeAI] Legacy migration warning:', (err as Error).message);
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch { /* may race with another process */ }
  }
}
