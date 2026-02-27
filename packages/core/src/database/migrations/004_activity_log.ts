import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('activity_log', (table) => {
    table.bigIncrements('id');
    table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
    table.string('type', 32).notNullable(); // tool_exec, host_cmd, blocked, error
    table.string('tool_name', 64).notNullable();
    table.string('target', 16).notNullable().defaultTo('server'); // server, host, companion
    table.string('command', 1024).nullable(); // for shell_exec: the actual command
    table.string('summary', 512).notNullable(); // human-readable description
    table.enum('risk_level', ['low', 'medium', 'high', 'critical']).notNullable().defaultTo('low');
    table.boolean('success').notNullable().defaultTo(true);
    table.integer('duration_ms').nullable();
    table.string('session_id', 64).nullable();
    table.string('user_id', 64).nullable();

    table.index('timestamp');
    table.index('type');
    table.index('target');
    table.index('risk_level');
    table.index(['timestamp', 'type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activity_log');
}
