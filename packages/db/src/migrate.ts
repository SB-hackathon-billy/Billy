import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { createPool } from './storage.js';
export async function migrate(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('sb:migrations'))");
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      await c.query(await readFile(new URL(name, dir), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}
