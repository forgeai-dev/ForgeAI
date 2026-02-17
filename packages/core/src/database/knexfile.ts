import type { Knex } from 'knex';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../.env') });

const knexConfig: Knex.Config = {
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
  migrations: {
    directory: resolve(__dirname, './migrations'),
    tableName: 'forgeai_migrations',
    extension: 'ts',
  },
  seeds: {
    directory: resolve(__dirname, './seeds'),
    extension: 'ts',
  },
};

export default knexConfig;
