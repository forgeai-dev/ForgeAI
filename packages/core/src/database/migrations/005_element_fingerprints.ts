import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('element_fingerprints', (table) => {
    table.string('id', 16).primary();
    table.string('url', 2048).notNullable();
    table.string('selector', 1024).notNullable();
    table.json('fingerprint_json').notNullable();
    table.timestamp('last_matched').notNullable().defaultTo(knex.fn.now());
    table.integer('match_count').notNullable().defaultTo(1);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('url');
    table.index('last_matched');
    table.index('match_count');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('element_fingerprints');
}
