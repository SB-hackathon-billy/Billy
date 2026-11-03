import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiPorts, type AiPorts, type FixtureScenario } from '@sb/ai';
import { buildSeed, defaultRequestPeriod } from '@sb/demo-data';
import {
  createEmptyNeed,
  type AgentTaskDetail,
  type NeedDraft,
  type PricingQuote,
  type RequestView,
} from '@sb/contracts';
import { createTestDatabase, DEFAULT_DATABASE_URL, seed, type Database } from '@sb/db';
import { RentalWorker, TASK_QUEUE } from '../src/worker.js';

let db: Database;
let cleanup: () => Promise<void>;
let worker: RentalWorker | undefined;
let child: ChildProcess | undefined;
let now: Date;
const fixture = (scenario: FixtureScenario = 'normal') =>
  createAiPorts({ AI_MODE: 'fixture' }, { scenario });
const need = (overrides: Partial<NeedDraft> = {}): NeedDraft => ({
  category: 'HOBBY',
  queryText: '프로젝터',
  ...defaultRequestPeriod(now),
  preferredPlaceIds: ['place-center', 'place-station', 'place-library'],
  maxBudgetKrw: null,
  ...overrides,
});
async function until<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeout = 20_000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (matches(value)) return value;
    await delay(40);
  }
  throw new Error('Timed out waiting for persisted worker outcome');
}
const view = (id: string) => db.transaction((u) => u.getRequest('u_hana', id));
async function start(ai = fixture()) {
  worker = new RentalWorker({ db, ai, dispatchIntervalMs: 50, recoveryIntervalMs: 300 });
  await worker.start();
  return worker;
}
async function search(draft = need()) {
  const created = await db.transaction((u) => u.create('u_hana', draft));
  const accepted = await db.transaction((u) => u.confirmAndSearch('u_hana', created.request.id, 1));
  return { ...accepted, id: created.request.id };
}
async function matches(draft = need()) {
  const searched = await search(draft);
  return until(
    () => view(searched.id),
    (v) => v.request.status === 'MATCHES_READY',
  );
}
async function submit(v: RequestView, ids: string[]) {
  return db.transaction((u) =>
    u.submit('u_hana', v.request.id, {
      expectedRequestVersion: v.request.version,
      selections: ids.map((id) => {
        const c = v.candidates.find((candidate) => candidate.itemId === id)!;
        return { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw };
      }),
    }),
  );
}
async function tasks(requestId: string, kind: string): Promise<AgentTaskDetail[]> {
  const { rows } = await db.pool.query<{ id: string }>(
    "SELECT id FROM agent_tasks WHERE request_id=$1 AND data->>'kind'=$2 ORDER BY id",
    [requestId, kind],
  );
  return Promise.all(rows.map((row) => db.getTask(row.id)));
}
async function quotes(requestId: string): Promise<PricingQuote[]> {
  const { rows } = await db.pool.query<{ data: PricingQuote }>(
    'SELECT data FROM pricing_quotes WHERE request_id=$1 ORDER BY id',
    [requestId],
  );
  return rows.map((row) => row.data);
}
beforeEach(async () => {
  vi.stubEnv('APP_MODE', 'automated-test');
  now = new Date();
  const test = await createTestDatabase({ now: () => now });
  db = test.db;
  cleanup = test.cleanup;
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  child = undefined;
  await worker?.stop();
  worker = undefined;
  await cleanup();
  vi.unstubAllEnvs();
});

describe('real PostgreSQL + pg-boss worker', () => {
  it('AT03 public projector becomes PUBLIC_DEMO OFFERED after demo delay; residents stay pending', async () => {
    await start();
    const found = await matches();
    const pending = await submit(found, ['pub-projector', 'res-projector-duri']);
    const submittedAt = Date.now();
    const offered = await until(
      () => view(pending.request.id),
      (v) => v.negotiations.some((n) => n.itemId === 'pub-projector' && n.status === 'OFFERED'),
    );
    expect(Date.now() - submittedAt).toBeGreaterThanOrEqual(950);
    const pub = offered.negotiations.find((n) => n.itemId === 'pub-projector')!;
    expect(pub.offer?.endorsedBy).toBe('PUBLIC_DEMO');
    expect(pub).not.toHaveProperty('externalApplicationId');
    expect(pub.offer).not.toHaveProperty('externalApplicationId');
    expect(offered.negotiations.find((n) => n.ownerId)?.status).toBe('AWAITING_OWNER');
    await until(
      () => tasks(pending.request.id, 'COMPARE_OFFERS'),
      (ts) => ts.some((t) => t.status === 'SUCCEEDED'),
    );
    const events = await db.eventsAfter('u_hana', '0');
    expect(events.events.some((e) => e.type === 'agent.task.updated')).toBe(true);
  });

  it('AT18 public ladder declines and closes the request as NO_OFFERS', async () => {
    await start();
    const found = await matches(need({ category: 'TOOLS', queryText: '사다리' }));
    await submit(found, ['pub-ladder']);
    const result = await until(
      () => view(found.request.id),
      (v) => v.request.status === 'NO_OFFERS',
    );
    expect(result.negotiations[0]).toMatchObject({
      status: 'DECLINED',
      closedReason: 'PUBLIC_DEMO_DECLINED',
      offer: null,
    });
  });

  it.each(['failure', 'timeout', 'invalid-option'] as const)(
    'AT15 %s price response uses BASELINE',
    async (scenario) => {
      await start(fixture(scenario));
      const found = await matches();
      const all = await quotes(found.request.id);
      const residents = all.filter((q) => q.itemId.startsWith('res-'));
      expect(residents.length).toBeGreaterThan(0);
      for (const q of residents) {
        expect(q.recommendationSource).toBe('BASELINE');
        expect(q.recommendedKrw).toBe(q.baselineKrw);
      }
      expect(all.find((q) => q.itemId === 'pub-projector')?.recommendationSource).toBe(
        'PUBLIC_FIXED',
      );
      expect((await tasks(found.request.id, 'SEARCH'))[0]?.status).toBe('SUCCEEDED');
    },
  );

  it('AT15 enforces the real eight-second deadline and never overwrites the quote with a late recommendation', async () => {
    const ai = fixture();
    let late!: () => void;
    let first = true;
    const slow: AiPorts = {
      ...ai,
      feeRecommender: {
        recommend: async (input) => {
          if (!first) return null;
          first = false;
          await new Promise<void>((resolve) => {
            late = resolve;
          });
          return ai.feeRecommender.recommend(input);
        },
      },
    };
    await start(slow);
    const before = Date.now();
    const found = await matches();
    expect(Date.now() - before).toBeGreaterThanOrEqual(8_000);
    const original = await quotes(found.request.id);
    expect(
      original
        .filter((q) => q.itemId.startsWith('res-'))
        .every((q) => q.recommendationSource === 'BASELINE'),
    ).toBe(true);
    late();
    await delay(100);
    expect(await quotes(found.request.id)).toEqual(original);
  });

  it('ROUTE_INTENT delegates to EXTRACT_NEED, persists a proposal and leaves the draft untouched', async () => {
    await start();
    const draft = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    const turn = await db.transaction((u) =>
      u.agentTurn('u_hana', {
        requestId: draft.request.id,
        expectedRequestVersion: 1,
        text: '모레 오전 열 시부터 다음날 오후 네 시까지 프로젝터가 필요해요.',
      }),
    );
    const result = await until(
      () => tasks(draft.request.id, 'EXTRACT_NEED'),
      (ts) => ts.some((t) => t.status === 'SUCCEEDED'),
    );
    expect(result[0]?.result).toHaveProperty('proposedNeed.category', 'HOBBY');
    expect((await db.getTask(turn.taskId)).status).toBe('SUCCEEDED');
    expect((await view(draft.request.id)).request).toMatchObject({
      status: 'DRAFT',
      need: createEmptyNeed(),
      needRevision: 1,
    });
  });

  it('AT17 re-delivered outbox and queue jobs commit exactly one SEARCH effect', async () => {
    await start();
    const pending = await search();
    await Promise.all(Array.from({ length: 4 }, () => worker!.dispatchOutbox()));
    const found = await until(
      () => view(pending.id),
      (v) => v.request.status === 'MATCHES_READY',
    );
    await worker!.boss.send(TASK_QUEUE, { taskId: pending.taskId });
    await worker!.boss.send(TASK_QUEUE, { taskId: pending.taskId });
    await until(
      () => worker!.boss.findJobs(TASK_QUEUE),
      (js) => js.every((j) => ['completed', 'failed'].includes(j.state)),
    );
    const effects = await db.pool.query('SELECT * FROM task_effects WHERE task_id=$1 AND step=$2', [
      pending.taskId,
      'SEARCH',
    ]);
    expect(effects.rowCount).toBe(1);
    expect((await view(pending.id)).candidates).toEqual(found.candidates);
    expect((await db.getTask(pending.taskId)).attempt).toBe(1);
  });

  it('AT17 resumes an active public job after SIGKILL and reuses its durable queue job', async () => {
    await start();
    const found = await matches();
    await worker!.stop();
    worker = undefined;
    await submit(found, ['pub-projector']);
    const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL);
    const name = (await db.pool.query<{ name: string }>('SELECT current_database() AS name'))
      .rows[0]!.name;
    url.pathname = `/${name}`;
    child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))],
      {
        env: { ...process.env, DATABASE_URL: url.toString(), AI_MODE: 'fixture' },
        stdio: 'ignore',
      },
    );
    const active = await until(
      () => tasks(found.request.id, 'PUBLIC_SUBMIT'),
      (ts) => ts.some((t) => t.status === 'RUNNING'),
    );
    child.kill('SIGKILL');
    await once(child, 'exit');
    child = undefined;
    await start();
    const result = await until(
      () => view(found.request.id),
      (v) => v.negotiations[0]?.status === 'OFFERED',
      30_000,
    );
    expect(result.negotiations[0]?.offer?.endorsedBy).toBe('PUBLIC_DEMO');
    expect((await db.getTask(active[0]!.id)).attempt).toBe(2);
    const effects = await db.pool.query('SELECT * FROM task_effects WHERE task_id=$1 AND step=$2', [
      active[0]!.id,
      'PUBLIC_SUBMIT',
    ]);
    expect(effects.rowCount).toBe(1);
  });

  it('AT17 discards a late extraction after cancellation without reviving the request', async () => {
    const ai = fixture();
    let release!: () => void;
    await start({
      ...ai,
      runTask: async (input) => {
        if (input.kind === 'EXTRACT_NEED')
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return ai.runTask(input);
      },
    });
    const draft = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    await db.transaction((u) =>
      u.agentTurn('u_hana', {
        requestId: draft.request.id,
        expectedRequestVersion: 1,
        text: '프로젝터가 필요해요.',
      }),
    );
    const active = await until(
      () => tasks(draft.request.id, 'EXTRACT_NEED'),
      (ts) => ts.some((t) => t.status === 'RUNNING') && !!release,
    );
    await db.transaction((u) => u.cancel('u_hana', draft.request.id, 1));
    release();
    await until(
      () => worker!.boss.findJobs(TASK_QUEUE),
      (js) => js.every((j) => ['completed', 'failed'].includes(j.state)),
    );
    expect(await db.getTask(active[0]!.id)).toMatchObject({ status: 'CANCELLED', result: null });
    expect((await view(draft.request.id)).request.status).toBe('CANCELLED');
    const effects = await db.pool.query('SELECT * FROM task_effects WHERE task_id=$1', [
      active[0]!.id,
    ]);
    expect(effects.rowCount).toBe(0);
  });

  it('AT18 distinguishes NO_MATCH and root EXPIRED, with no automatic resident response', async () => {
    await start();
    const absent = await search(need({ category: 'TRAVEL' }));
    await until(
      () => view(absent.id),
      (v) => v.request.status === 'NO_MATCH',
    );
    const pending = await submit(await matches(), ['res-projector-duri']);
    await delay(700);
    expect((await view(pending.request.id)).negotiations[0]?.status).toBe('AWAITING_OWNER');
    now = new Date(pending.request.expiresAt);
    // Inspect stored state directly: this proves the periodic worker, not lazy GET expiry, ran.
    await until(
      async () =>
        (
          await db.pool.query<{ data: RequestView['request'] }>(
            'SELECT data FROM rental_requests WHERE id=$1',
            [pending.request.id],
          )
        ).rows[0]!.data,
      (r) => r.status === 'EXPIRED',
      2_000,
    );
    expect((await view(pending.request.id)).negotiations[0]).toMatchObject({
      status: 'EXPIRED',
      offer: null,
    });
  });

  it('AT18 branch response deadline before root yields NO_OFFERS and never an offer', async () => {
    const data = buildSeed({ now });
    data.scenario.timing.responseMs = 5_000;
    await seed(db.pool, data);
    await start();
    const pending = await submit(await matches(), ['res-projector-duri']);
    now = new Date(pending.negotiations[0]!.responseDueAt!);
    const result = await until(
      () => view(pending.request.id),
      (v) => v.request.status === 'NO_OFFERS',
    );
    expect(result.negotiations[0]).toMatchObject({ status: 'EXPIRED', offer: null });
  });

  it('explanation/comparison failures retain server templates without rolling back an owner counter', async () => {
    await start(fixture('failure'));
    const pending = await submit(await matches(), ['res-projector-duri']);
    const n = pending.negotiations[0]!;
    const q = await db.transaction((u) =>
      u.issueQuote(n.ownerId!, {
        requestId: n.requestId,
        negotiationId: n.id,
        itemId: n.itemId,
        startAt: n.terms.startAt,
        endAt: n.terms.endAt,
      }),
    );
    await db.injectOwnerResponse(n.ownerId!, n.id, {
      action: 'COUNTER',
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: { ...n.terms, totalFeeKrw: q.minKrw, quoteId: q.id },
    });
    const explained = await until(
      () => tasks(n.requestId, 'EXPLAIN_TERMS'),
      (ts) => ts.some((t) => t.status === 'FAILED'),
    );
    const compared = await until(
      () => tasks(n.requestId, 'COMPARE_OFFERS'),
      (ts) => ts.some((t) => t.status === 'FAILED'),
    );
    expect(explained[0]?.result).toHaveProperty('summary');
    expect(compared[0]?.result).toHaveProperty('rows');
    expect((await view(n.requestId)).negotiations[0]).toMatchObject({
      status: 'OFFERED',
      termsRevision: 2,
    });
  });

  it('transient SEARCH errors retry at 1s/4s and succeed on the third attempt', async () => {
    // A real PostgreSQL fault injection; sequence increments survive transaction rollback.
    await db.pool.query(`CREATE SEQUENCE search_failure_count;
      CREATE FUNCTION worker_test_fail_search() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF nextval('search_failure_count') <= 2 THEN RAISE EXCEPTION 'transient' USING ERRCODE='40001'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER worker_search_fault BEFORE INSERT ON candidates FOR EACH ROW EXECUTE FUNCTION worker_test_fail_search()`);
    await start();
    const before = Date.now();
    const pending = await search();
    await until(
      () => view(pending.id),
      (v) => v.request.status === 'MATCHES_READY',
    );
    expect(Date.now() - before).toBeGreaterThanOrEqual(5_000);
    expect(await db.getTask(pending.taskId)).toMatchObject({ status: 'SUCCEEDED', attempt: 3 });
  });

  it('SEARCH reaches FAILED after three transient failures, while public failure becomes UNAVAILABLE', async () => {
    await db.pool
      .query(`CREATE FUNCTION worker_test_fail_search() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'transient' USING ERRCODE='40001'; END $$;
      CREATE TRIGGER worker_search_fault BEFORE INSERT ON candidates FOR EACH ROW EXECUTE FUNCTION worker_test_fail_search()`);
    await start();
    const pending = await search();
    await until(
      () => view(pending.id),
      (v) => v.request.status === 'FAILED',
    );
    expect(await db.getTask(pending.taskId)).toMatchObject({ status: 'FAILED', attempt: 3 });
    await db.pool.query('DROP TRIGGER worker_search_fault ON candidates');
    const found = await matches();
    await db.pool
      .query(`CREATE FUNCTION worker_test_fail_public() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.data->>'status'='OFFERED' AND NEW.data->>'source'='PUBLIC' THEN RAISE EXCEPTION 'public failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER worker_public_fault BEFORE UPDATE ON negotiations FOR EACH ROW EXECUTE FUNCTION worker_test_fail_public()`);
    await submit(found, ['pub-projector']);
    const result = await until(
      () => view(found.request.id),
      (v) => v.request.status === 'NO_OFFERS',
    );
    expect(result.negotiations[0]).toMatchObject({
      status: 'UNAVAILABLE',
      closedReason: 'PUBLIC_DEMO_ERROR',
    });
  });
});
