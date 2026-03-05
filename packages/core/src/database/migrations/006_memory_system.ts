import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ─── Memory Entries ───────────────────────────────
  await knex.schema.createTable('memory_entries', (table) => {
    table.string('id', 64).primary();
    table.text('content').notNullable();
    table.json('embedding_json').nullable(); // float[] as JSON (1536 dims for OpenAI, variable for TF-IDF)
    table.json('metadata').nullable();
    table.string('session_id', 64).nullable();
    table.string('agent_id', 64).nullable();
    table.string('memory_type', 32).notNullable().defaultTo('general');
    // session_summary, learning, topic, user_preference, entity, general
    table.decimal('importance', 3, 2).notNullable().defaultTo(0.5);
    table.string('embedding_provider', 16).notNullable().defaultTo('tfidf'); // tfidf | openai
    table.integer('access_count').notNullable().defaultTo(0);
    table.timestamp('last_accessed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('session_id');
    table.index('agent_id');
    table.index('memory_type');
    table.index('importance');
    table.index('created_at');
    table.index('last_accessed_at');
  });

  // ─── Memory Entities ──────────────────────────────
  // Extracted named entities linked to memory entries
  await knex.schema.createTable('memory_entities', (table) => {
    table.string('id', 64).primary();
    table.string('name', 255).notNullable();
    table.string('entity_type', 32).notNullable();
    // person, project, technology, preference, location, organization
    table.string('memory_id', 64).notNullable().references('id').inTable('memory_entries').onDelete('CASCADE');
    table.json('attributes').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('entity_type');
  });
  // Prefix index for name (191 chars max for utf8mb4)
  await knex.raw('CREATE INDEX `memory_entities_name_index` ON `memory_entities` (`name`(191))');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('memory_entities');
  await knex.schema.dropTableIfExists('memory_entries');
}
