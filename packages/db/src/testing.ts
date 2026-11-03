import { randomUUID } from 'node:crypto';
import { buildSeed, type SeedData } from '@sb/demo-data';
import { Database } from './database.js';
import { createPool, DEFAULT_DATABASE_URL } from './storage.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
/** One private database per test file. Never truncates the shared development DB. */
export async function createTestDatabase(options: { now?: () => Date; fixture?: SeedData } = {}) {
  const admin = createPool(process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL);
  const name = `sb_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL);
  url.pathname = `/${name}`;
  const pool = createPool(url.toString());
  const db = new Database({ pool, ...(options.now ? { now: options.now } : {}) });
  try {
    await migrate(pool);
    await seed(pool, options.fixture ?? buildSeed({ now: db.now() }));
  } catch (e) {
    await db.close();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw e;
  }
  return {
    db,
    cleanup: async () => {
      await db.close();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
