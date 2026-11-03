import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL } from '@sb/db';
import { SseEventSchema, type PricingQuote } from '@sb/contracts';
import { EventGate } from '../../apps/web/src/lib/realtime.js';
import { TASK_QUEUE } from '../../apps/worker/src/worker.js';
import { harness, type Harness, fixture, stream, until } from './harness.js';
let h: Harness;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  child = undefined;
  await h?.close();
});

it('AT14 real SSE duplicates, missed events, stale snapshots, expired cursors and user rotation', async () => {
  h = await harness();
  const before = await h.sync();
  const first = await stream(h, 'hana', before.eventCursor);
  let resume: Awaited<ReturnType<typeof stream>> | undefined;
  let expired: Awaited<ReturnType<typeof stream>> | undefined;
  let rotation: Awaited<ReturnType<typeof stream>> | undefined;
  try {
    const heartbeat = await first.wait((e) => e.type === 'heartbeat');
    expect(heartbeat.id).toBeUndefined();
    const draft = await h.create();
    const created = await first.wait(
      (e) => e.type === 'request.updated' && e.data.requestId === draft.request.id,
    );
    const gate = new EventGate();
    gate.snapshot(before);
    const parsed = SseEventSchema.parse(created.data);
    expect(gate.accept(parsed)).toBe(true);
    expect(gate.accept(parsed)).toBe(false);
    await first.close();
    const r = await h.api('hana', 'PATCH', `/requests/${draft.request.id}/draft`, {
      expectedRequestVersion: 1,
      need: h.need({ queryText: '변경된 프로젝터' }),
    });
    expect(r.statusCode).toBe(200);
    const snapshot = await h.sync();
    expect(snapshot.requestSummaries[0]!.version).toBe(2);
    // The real client observes the newest REST detail before a delayed lower-version event arrives.
    const delayed = new EventGate();
    delayed.snapshot(before);
    delayed.observeRequest(draft.request.id, 2);
    expect(delayed.accept(parsed)).toBe(false);
    resume = await stream(h, 'hana', '0', created.id);
    const recovered = await resume.wait(
      (e) => e.type === 'request.updated' && e.data.requestVersion === 2,
    );
    expect(BigInt(recovered.id!)).toBeGreaterThan(BigInt(created.id!));
    expect(
      resume.events.filter((e) => e.id).every((e) => BigInt(e.id!) > BigInt(created.id!)),
    ).toBe(true);
    expect(gate.accept(SseEventSchema.parse(recovered.data))).toBe(true);
    expect((await h.fresh(draft.request.id)).request.version).toBe(2);
    await resume.close();
    resume = undefined;
    // Retention boundary fault injection touches event retention timestamps only.
    await h.db.pool.query(
      "UPDATE user_events SET occurred_at=now()-interval '25 hours' WHERE user_id='u_hana'",
    );
    expired = await stream(h, 'hana', '0');
    expect((await expired.wait((e) => e.type === 'sync.required')).type).toBe('sync.required');
    await expired.close();
    expired = undefined;
    const current = await h.sync();
    rotation = await stream(h, 'hana', current.eventCursor);
    const old = h.actors.hana!;
    const duri = await h.enter('demo-duri', old);
    expect((await rotation.wait((e) => e.type === 'session.revoked')).type).toBe('session.revoked');
    expect((await h.api(old, 'GET', '/sync')).statusCode).toBe(401);
    const switched = await h.sync(duri);
    expect(switched.requestSummaries).toEqual([]);
    expect(JSON.stringify(switched)).not.toContain(draft.request.id);
    expect((await h.api(duri, 'GET', `/requests/${draft.request.id}`)).statusCode).toBe(404);
  } finally {
    await first.close();
    await resume?.close();
    await expired?.close();
    await rotation?.close();
  }
});

it('AT15 real eight-second price deadline returns baseline and ignores late fixture completion', async () => {
  const ai = fixture();
  let calls = 0;
  let finished = false;
  h = await harness({
    ai: {
      ...ai,
      feeRecommender: {
        recommend: async (input) => {
          calls++;
          await delay(9000);
          const value = await ai.feeRecommender.recommend(input);
          finished = true;
          return value;
        },
      },
    },
  });
  const start = Date.now();
  const found = await h.matches('hana', h.need({ category: 'CLEANING', queryText: '청소기' }));
  expect(Date.now() - start).toBeGreaterThanOrEqual(8000);
  expect(calls).toBe(1);
  expect(finished).toBe(false);
  const quotes = await h.db.pool.query<{ data: PricingQuote }>(
    'SELECT data FROM pricing_quotes WHERE request_id=$1',
    [found.request.id],
  );
  const resident = quotes.rows.find((r) => r.data.itemId === 'res-cleaner-duri')!.data;
  expect(resident).toMatchObject({
    recommendedKrw: 2000,
    recommendationSource: 'BASELINE',
    reasonCode: 'BASELINE',
  });
  await until(
    async () => finished,
    (b) => b,
    3000,
  );
  const after = await h.db.pool.query('SELECT data FROM pricing_quotes WHERE id=$1', [resident.id]);
  expect(after.rows[0].data).toEqual(resident);
});

it('AT17 duplicated outbox dispatch and queue delivery commit one search effect', async () => {
  h = await harness();
  const search = await h.search();
  await Promise.all(Array.from({ length: 4 }, () => h.worker.dispatchOutbox()));
  const found = await until(
    () => h.fresh(search.view.request.id),
    (v) => v.request.status === 'MATCHES_READY',
  );
  await h.worker.boss.send(TASK_QUEUE, { taskId: search.taskId });
  await h.worker.boss.send(TASK_QUEUE, { taskId: search.taskId });
  await until(
    () => h.worker.boss.findJobs(TASK_QUEUE),
    (js) => js.every((j) => ['completed', 'failed'].includes(j.state)),
  );
  const effects = await h.db.pool.query('SELECT * FROM task_effects WHERE task_id=$1 AND step=$2', [
    search.taskId,
    'SEARCH',
  ]);
  expect(effects.rowCount).toBe(1);
  expect((await h.fresh(found.request.id)).candidates).toEqual(found.candidates);
  expect((await h.db.getTask(search.taskId)).attempt).toBe(1);
});

it('AT17 SIGKILL a real worker during public submission, restart and resume the durable job exactly once', async () => {
  h = await harness();
  const found = await h.matches();
  await h.stopWorker();
  const submitted = await h.submit(found, ['pub-projector']);
  const task = submitted.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
  const name = (await h.db.pool.query<{ name: string }>('SELECT current_database() AS name'))
    .rows[0]!.name;
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL);
  url.pathname = `/${name}`;
  child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('../../apps/worker/src/main.ts', import.meta.url))],
    { env: { ...process.env, DATABASE_URL: url.toString(), AI_MODE: 'fixture' }, stdio: 'ignore' },
  );
  await until(
    () => h.db.getTask(task.id),
    (t) => t.status === 'RUNNING',
  );
  child.kill('SIGKILL');
  await once(child, 'exit');
  child = undefined;
  expect((await h.fresh(found.request.id)).negotiations[0]!.status).toBe('PENDING_PUBLIC');
  await h.startWorker();
  const recovered = await until(
    () => h.fresh(found.request.id),
    (v) => v.negotiations[0]?.status === 'OFFERED',
    30000,
  );
  expect(recovered.negotiations[0]!.offer!.endorsedBy).toBe('PUBLIC_DEMO');
  expect((await h.db.getTask(task.id)).attempt).toBe(2);
  expect(
    (
      await h.db.pool.query(
        'SELECT count(*)::int AS n FROM task_effects WHERE task_id=$1 AND step=$2',
        [task.id, 'PUBLIC_SUBMIT'],
      )
    ).rows[0].n,
  ).toBe(1);
});

it('AT17 cancelling during the real public adapter delay discards its late result', async () => {
  h = await harness();
  const v = await h.submit(await h.matches(), ['pub-projector']);
  const task = v.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
  await until(
    () => h.db.getTask(task.id),
    (t) => t.status === 'RUNNING',
  );
  const current = await h.fresh(v.request.id);
  const cancelled = await h.api('hana', 'POST', `/requests/${v.request.id}/cancel`, {
    expectedRequestVersion: current.request.version,
  });
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  await until(
    () => h.worker.boss.findJobs(TASK_QUEUE),
    (js) => js.every((j) => ['completed', 'failed'].includes(j.state)),
  );
  const final = await h.fresh(v.request.id);
  expect(final.request.status).toBe('CANCELLED');
  expect(final.negotiations[0]).toMatchObject({ status: 'WITHDRAWN', offer: null });
  expect((await h.db.getTask(task.id)).status).toBe('CANCELLED');
  expect(
    (
      await h.db.pool.query('SELECT count(*)::int AS n FROM task_effects WHERE task_id=$1', [
        task.id,
      ])
    ).rows[0].n,
  ).toBe(0);
});

it('AT18 transient search failure retries three times then reaches FAILED', async () => {
  h = await harness();
  await h.db.pool
    .query(`CREATE FUNCTION acceptance_search_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'transient acceptance fault' USING ERRCODE='40001'; END $$;
    CREATE TRIGGER acceptance_search_fault BEFORE INSERT ON candidates FOR EACH ROW EXECUTE FUNCTION acceptance_search_fault()`);
  const s = await h.search();
  await until(
    () => h.fresh(s.view.request.id),
    (v) => v.request.status === 'FAILED',
  );
  expect(await h.db.getTask(s.taskId)).toMatchObject({ status: 'FAILED', attempt: 3 });
});
