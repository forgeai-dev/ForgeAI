import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('blocked_ips');
  if (!exists) {
    await knex.schema.createTable('blocked_ips', (table) => {
      table.string('ip', 45).primary();
      table.string('reason', 255).notNullable().defaultTo('Manual block');
      table.boolean('auto_blocked').notNullable().defaultTo(false);
      table.integer('threat_count').notNullable().defaultTo(0);
      table.bigInteger('blocked_at').notNullable();
      table.bigInteger('expires_at').notNullable().defaultTo(0); // 0 = permanent
      table.bigInteger('first_seen').notNullable();
      table.bigInteger('last_seen').notNullable();
      table.index('expires_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('blocked_ips');
}
