import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add hash chain columns to audit_log for tamper detection
  const hasHash = await knex.schema.hasColumn('audit_log', 'hash');
  if (!hasHash) {
    await knex.schema.alterTable('audit_log', (table) => {
      table.string('hash', 64).nullable();
      table.string('previous_hash', 64).nullable();
      table.index('hash');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasHash = await knex.schema.hasColumn('audit_log', 'hash');
  if (hasHash) {
    await knex.schema.alterTable('audit_log', (table) => {
      table.dropIndex('hash');
      table.dropColumn('hash');
      table.dropColumn('previous_hash');
    });
  }
}
