import { buildKnexConfig } from './src/db/knex.js';

export default {
  ...buildKnexConfig(),
  migrations: { directory: './src/db/migrations' },
  seeds: { directory: './src/db/seeds' },
};
