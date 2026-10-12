import knexLib from 'knex';
import { config } from '../config.js';

// ค่า pool ตั้งให้เหมาะกับ TiDB Cloud: public endpoint ตัด idle ที่ ~340 วินาที
// จึงปิด connection ที่ว่างก่อนถึงเวลานั้น และไม่ถือ connection นานเกิน 5 นาที
export function buildKnexConfig(env = config) {
  return {
    client: 'mysql2',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      charset: 'utf8mb4',
      timezone: 'Z',
      ssl: env.DB_SSL ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 120_000,
      reapIntervalMillis: 30_000,
    },
  };
}

export const db = knexLib(buildKnexConfig());
