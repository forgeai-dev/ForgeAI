import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ─── Users ──────────────────────────────────────────
  await knex.schema.createTable('users', (table) => {
    table.string('id', 64).primary();
    table.string('username', 100).notNullable().unique();
    table.string('email', 255).nullable();
    table.string('password_hash', 255).notNullable();
    table.enum('role', ['admin', 'user', 'guest']).notNullable().defaultTo('user');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('two_factor_enabled').notNullable().defaultTo(false);
    table.string('two_factor_secret', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('username');
    table.index('email');
    table.index('role');
  });

  // ─── Sessions ───────────────────────────────────────
  await knex.schema.createTable('sessions', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 64).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('agent_id', 64).notNullable();
    table.string('channel_id', 128).notNullable();
    table.string('channel_type', 32).notNullable();
    table.enum('status', ['active', 'idle', 'closed', 'suspended']).notNullable().defaultTo('active');
    table.boolean('sandboxed').notNullable().defaultTo(true);
    table.json('metadata').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('last_activity_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('channel_type');
    table.index('status');
    table.index('last_activity_at');
  });

  // ─── Messages ───────────────────────────────────────
  await knex.schema.createTable('messages', (table) => {
    table.string('id', 64).primary();
    table.string('session_id', 64).notNullable().references('id').inTable('sessions').onDelete('CASCADE');
    table.enum('role', ['user', 'assistant', 'system', 'tool']).notNullable();
    table.text('content').notNullable();
    table.json('tool_calls').nullable();
    table.integer('token_count').nullable();
    table.decimal('cost', 10, 6).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('session_id');
    table.index('role');
    table.index('created_at');
  });

  // ─── Audit Log ──────────────────────────────────────
  await knex.schema.createTable('audit_log', (table) => {
    table.string('id', 64).primary();
    table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
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
    table.index(['action', 'timestamp']);
  });

  // ─── Vault Entries ──────────────────────────────────
  await knex.schema.createTable('vault_entries', (table) => {
    table.string('key', 255).primary();
    table.text('encrypted_value').notNullable();
    table.string('iv', 64).notNullable();
    table.string('tag', 64).notNullable();
    table.string('salt', 128).notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ─── Channel Configs ────────────────────────────────
  await knex.schema.createTable('channel_configs', (table) => {
    table.string('id', 64).primary();
    table.string('channel_type', 32).notNullable();
    table.boolean('enabled').notNullable().defaultTo(false);
    table.json('allow_from').nullable();
    table.json('deny_from').nullable();
    table.enum('dm_policy', ['pairing', 'open', 'closed']).notNullable().defaultTo('pairing');
    table.enum('group_policy', ['mention', 'always', 'closed']).notNullable().defaultTo('mention');
    table.json('rate_limit').nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['channel_type']);
  });

  // ─── Pairing Codes ──────────────────────────────────
  await knex.schema.createTable('pairing_codes', (table) => {
    table.string('id', 64).primary();
    table.string('code', 16).notNullable().unique();
    table.string('channel_type', 32).notNullable();
    table.string('sender_id', 255).notNullable();
    table.string('sender_name', 255).nullable();
    table.boolean('approved').notNullable().defaultTo(false);
    table.string('approved_by', 64).nullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('code');
    table.index('expires_at');
    table.index(['channel_type', 'sender_id']);
  });

  // ─── RBAC Permissions ───────────────────────────────
  await knex.schema.createTable('user_permissions', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 64).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('resource', 128).notNullable();
    table.string('action', 32).notNullable();
    table.boolean('allowed').notNullable().defaultTo(true);
    table.json('conditions').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'resource', 'action']);
    table.index('user_id');
  });

  // ─── Rate Limit Tracking ───────────────────────────
  await knex.schema.createTable('rate_limit_log', (table) => {
    table.bigIncrements('id');
    table.string('key', 255).notNullable();
    table.integer('count').notNullable().defaultTo(1);
    table.timestamp('window_start').notNullable();
    table.timestamp('window_end').notNullable();

    table.index('key');
    table.index('window_end');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('rate_limit_log');
  await knex.schema.dropTableIfExists('user_permissions');
  await knex.schema.dropTableIfExists('pairing_codes');
  await knex.schema.dropTableIfExists('channel_configs');
  await knex.schema.dropTableIfExists('vault_entries');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
}
