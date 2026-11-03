import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { buildSeed, type SeedData } from '@sb/demo-data';
import { DemoScenarioSchema } from '@sb/contracts';
import { createPool, put } from './storage.js';
export async function seed(pool: Pool, fixture: SeedData = buildSeed()): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'TRUNCATE app_config,users,places,items,item_unavailable_intervals,sessions,rental_requests,request_need_revisions,summary_confirmations,pricing_quotes,fee_cache,candidates,negotiations,terms_revisions,offers,demo_holds,agent_tasks,task_effects,outbox,user_events,idempotency_records RESTART IDENTITY CASCADE',
    );
    await c.query('INSERT INTO app_config(data) VALUES($1)', [fixture.scenario]);
    for (const user of fixture.users) await put(c, 'users', user, true);
    for (const place of fixture.places) await put(c, 'places', place, true);
    for (const item of fixture.items) {
      await put(c, 'items', item, true);
      for (const p of item.unavailableIntervals)
        await c.query(
          "INSERT INTO item_unavailable_intervals(item_id,period) VALUES($1,tstzrange($2,$3,'[)'))",
          [item.id, p.startAt, p.endAt],
        );
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
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(name) + 1];
  const scenario = DemoScenarioSchema.parse(
    args.includes('--scenario') ? option('--scenario') : 'default',
  );
  const now = args.includes('--now') ? option('--now') : new Date();
  const pool = createPool();
  try {
    await seed(pool, buildSeed({ scenario, now: now! }));
    console.log(`Seeded ${scenario}: 4 users, 3 places, 10 items.`);
  } finally {
    await pool.end();
  }
}
