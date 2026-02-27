import knex, { type Knex } from 'knex';
import { createLogger } from '@forgeai/shared';

const logger = createLogger('Core:Database');

let db: Knex | null = null;

function buildKnexConfig(): Knex.Config {
  return {
    client: 'mysql2',
    connection: {
      host: process.env['MYSQL_HOST'] || '127.0.0.1',
      port: Number(process.env['MYSQL_PORT']) || 3306,
      user: process.env['MYSQL_USER'] || 'root',
      password: process.env['MYSQL_PASSWORD'] || '',
      database: process.env['MYSQL_DATABASE'] || 'forgeai',
      charset: 'utf8mb4',
    },
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30_000,
    },
  };
}

export async function initDatabase(): Promise<Knex> {
  if (db) return db;

  const config = buildKnexConfig();
  const conn = config.connection as Record<string, unknown>;

  logger.info('Connecting to MySQL...', {
    host: conn['host'] as string,
    database: conn['database'] as string,
  });

  db = knex(config);

  try {
    await db.raw('SELECT 1');
    logger.info('MySQL connection established');
  } catch (error) {
    logger.error('Failed to connect to MySQL', error);
    throw error;
  }

  return db;
}

export function getDatabase(): Knex {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export async function runMigrations(): Promise<void> {
  const database = getDatabase();
  logger.info('Running migrations...');

  try {
    // Check if migration tracking table exists
    const hasMigTable = await database.schema.hasTable('forgeai_migrations');
    let currentVersion = 0;

    if (hasMigTable) {
      const rows = await database('forgeai_migrations').select('version').orderBy('version', 'desc').limit(1);
      if (rows.length > 0) {
        currentVersion = (rows[0] as { version: number }).version;
      }
    } else {
      await database.schema.createTable('forgeai_migrations', (table) => {
        table.increments('id');
        table.integer('version').notNullable().unique();
        table.string('name', 255).notNullable();
        table.timestamp('applied_at').defaultTo(database.fn.now());
      });
    }

    // Migration 1: Initial Schema
    if (currentVersion < 1) {
      logger.info('Applying migration 001_initial_schema...');
      await applyMigration001(database);
      await database('forgeai_migrations').insert({ version: 1, name: '001_initial_schema' });
      logger.info('Migration 001_initial_schema applied');
    }

    // Migration 3: Audit Hash Chain
    if (currentVersion < 3) {
      logger.info('Applying migration 003_audit_hash_chain...');
      await applyMigration003(database);
      await database('forgeai_migrations').insert({ version: 3, name: '003_audit_hash_chain' });
      logger.info('Migration 003_audit_hash_chain applied');
    }

    // Migration 4: Activity Log
    if (currentVersion < 4) {
      logger.info('Applying migration 004_activity_log...');
      await applyMigration004(database);
      await database('forgeai_migrations').insert({ version: 4, name: '004_activity_log' });
      logger.info('Migration 004_activity_log applied');
    }

    // Migration 5: Element Fingerprints (Adaptive Tracking)
    if (currentVersion < 5) {
      logger.info('Applying migration 005_element_fingerprints...');
      await applyMigration005(database);
      await database('forgeai_migrations').insert({ version: 5, name: '005_element_fingerprints' });
      logger.info('Migration 005_element_fingerprints applied');
    }

    logger.info('All migrations applied successfully');
  } catch (error) {
    logger.error('Migration failed', error);
    throw error;
  }
}

async function applyMigration001(db: Knex): Promise<void> {
  // Users
  await db.schema.createTable('users', (table) => {
    table.string('id', 64).primary();
    table.string('username', 100).notNullable().unique();
    table.string('email', 255).nullable();
    table.string('password_hash', 255).notNullable();
    table.enum('role', ['admin', 'user', 'guest']).notNullable().defaultTo('user');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('two_factor_enabled').notNullable().defaultTo(false);
    table.string('two_factor_secret', 255).nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('updated_at').defaultTo(db.fn.now());
    table.index('username');
    table.index('email');
    table.index('role');
  });

  // Sessions
  await db.schema.createTable('sessions', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 64).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('agent_id', 64).notNullable();
    table.string('channel_id', 128).notNullable();
    table.string('channel_type', 32).notNullable();
    table.enum('status', ['active', 'idle', 'closed', 'suspended']).notNullable().defaultTo('active');
    table.boolean('sandboxed').notNullable().defaultTo(true);
    table.json('metadata').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('updated_at').defaultTo(db.fn.now());
    table.timestamp('last_activity_at').defaultTo(db.fn.now());
    table.index('user_id');
    table.index('channel_type');
    table.index('status');
    table.index('last_activity_at');
  });

  // Messages
  await db.schema.createTable('messages', (table) => {
    table.string('id', 64).primary();
    table.string('session_id', 64).notNullable().references('id').inTable('sessions').onDelete('CASCADE');
    table.enum('role', ['user', 'assistant', 'system', 'tool']).notNullable();
    table.text('content').notNullable();
    table.json('tool_calls').nullable();
    table.integer('token_count').nullable();
    table.decimal('cost', 10, 6).nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.index('session_id');
    table.index('role');
    table.index('created_at');
  });

  // Audit Log
  await db.schema.createTable('audit_log', (table) => {
    table.string('id', 64).primary();
    table.timestamp('timestamp').notNullable().defaultTo(db.fn.now());
    table.string('action', 64).notNullable();
    table.string('user_id', 64).nullable();
    table.string('session_id', 64).nullable();
    table.string('channel_type', 32).nullable();
    table.string('resource', 128).nullable();
    table.json('details').nullable();
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 512).nullable();
    table.boolean('success').notNullable().defaultTo(true);
    table.enum('risk_level', ['low', 'medium', 'high', 'critical']).notNullable().defaultTo('low');
    table.index('timestamp');
    table.index('action');
    table.index('user_id');
    table.index('session_id');
    table.index('risk_level');
  });

  // Vault Entries
  await db.schema.createTable('vault_entries', (table) => {
    table.string('key', 255).primary();
    table.text('encrypted_value').notNullable();
    table.string('iv', 64).notNullable();
    table.string('tag', 64).notNullable();
    table.string('salt', 128).notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('updated_at').defaultTo(db.fn.now());
  });

  // Channel Configs
  await db.schema.createTable('channel_configs', (table) => {
    table.string('id', 64).primary();
    table.string('channel_type', 32).notNullable().unique();
    table.boolean('enabled').notNullable().defaultTo(false);
    table.json('allow_from').nullable();
    table.json('deny_from').nullable();
    table.enum('dm_policy', ['pairing', 'open', 'closed']).notNullable().defaultTo('pairing');
    table.enum('group_policy', ['mention', 'always', 'closed']).notNullable().defaultTo('mention');
    table.json('rate_limit').nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('updated_at').defaultTo(db.fn.now());
  });

  // Pairing Codes
  await db.schema.createTable('pairing_codes', (table) => {
    table.string('id', 64).primary();
    table.string('code', 16).notNullable().unique();
    table.string('channel_type', 32).notNullable();
    table.string('sender_id', 255).notNullable();
    table.string('sender_name', 255).nullable();
    table.boolean('approved').notNullable().defaultTo(false);
    table.string('approved_by', 64).nullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.index('code');
    table.index('expires_at');
  });

  // User Permissions (RBAC)
  await db.schema.createTable('user_permissions', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 64).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('resource', 128).notNullable();
    table.string('action', 32).notNullable();
    table.boolean('allowed').notNullable().defaultTo(true);
    table.json('conditions').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.unique(['user_id', 'resource', 'action']);
    table.index('user_id');
  });

  // Rate Limit Tracking
  await db.schema.createTable('rate_limit_log', (table) => {
    table.bigIncrements('id');
    table.string('key', 255).notNullable();
    table.integer('count').notNullable().defaultTo(1);
    table.timestamp('window_start').notNullable().defaultTo(db.fn.now());
    table.timestamp('window_end').notNullable().defaultTo(db.fn.now());
    table.index('key');
    table.index('window_end');
  });
}

async function applyMigration003(db: Knex): Promise<void> {
  const hasHash = await db.schema.hasColumn('audit_log', 'hash');
  if (!hasHash) {
    await db.schema.alterTable('audit_log', (table) => {
      table.string('hash', 64).nullable();
      table.string('previous_hash', 64).nullable();
      table.index('hash');
    });
    logger.info('Added hash chain columns to audit_log');
  }
}

async function applyMigration004(db: Knex): Promise<void> {
  const hasTable = await db.schema.hasTable('activity_log');
  if (!hasTable) {
    await db.schema.createTable('activity_log', (table) => {
      table.bigIncrements('id');
      table.timestamp('timestamp').notNullable().defaultTo(db.fn.now());
      table.string('type', 32).notNullable();
      table.string('tool_name', 64).notNullable();
      table.string('target', 16).notNullable().defaultTo('server');
      table.string('command', 1024).nullable();
      table.string('summary', 512).notNullable();
      table.enum('risk_level', ['low', 'medium', 'high', 'critical']).notNullable().defaultTo('low');
      table.boolean('success').notNullable().defaultTo(true);
      table.integer('duration_ms').nullable();
      table.string('session_id', 64).nullable();
      table.string('user_id', 64).nullable();
      table.index('timestamp');
      table.index('type');
      table.index('target');
      table.index('risk_level');
    });
    logger.info('Created activity_log table');
  }
}

async function applyMigration005(db: Knex): Promise<void> {
  const hasTable = await db.schema.hasTable('element_fingerprints');
  if (!hasTable) {
    await db.schema.createTable('element_fingerprints', (table) => {
      table.string('id', 16).primary();
      table.string('url', 2048).notNullable();
      table.string('selector', 1024).notNullable();
      table.json('fingerprint_json').notNullable();
      table.timestamp('last_matched').notNullable().defaultTo(db.fn.now());
      table.integer('match_count').notNullable().defaultTo(1);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.index('url');
      table.index('last_matched');
      table.index('match_count');
    });
    logger.info('Created element_fingerprints table');
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    logger.info('MySQL connection closed');
  }
}
