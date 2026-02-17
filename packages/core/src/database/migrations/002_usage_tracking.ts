import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ─── Usage Log ────────────────────────────────────
  await knex.schema.createTable('usage_log', (table) => {
    table.string('id', 64).primary();
    table.string('session_id', 64).notNullable();
    table.string('user_id', 64).notNullable();
    table.string('provider', 32).notNullable();
    table.string('model', 128).notNullable();
    table.integer('prompt_tokens').notNullable().defaultTo(0);
    table.integer('completion_tokens').notNullable().defaultTo(0);
    table.integer('total_tokens').notNullable().defaultTo(0);
    table.integer('thinking_tokens').nullable();
    table.decimal('cost', 12, 8).notNullable().defaultTo(0);
    table.integer('duration_ms').notNullable().defaultTo(0);
    table.string('channel_type', 32).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('session_id');
    table.index('user_id');
    table.index('provider');
    table.index('model');
    table.index('created_at');
    table.index(['user_id', 'created_at']);
  });

  // ─── Add model/provider/token tracking to messages ─
  await knex.schema.alterTable('messages', (table) => {
    table.string('model', 128).nullable().after('cost');
    table.string('provider', 32).nullable().after('model');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('usage_log');
  await knex.schema.alterTable('messages', (table) => {
    table.dropColumn('model');
    table.dropColumn('provider');
  });
}
