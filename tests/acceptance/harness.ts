import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { expect } from 'vitest';
import { createAiPorts, type AiPorts, type FixtureScenario } from '@sb/ai';
import * as C from '@sb/contracts';
import { buildSeed, defaultRequestPeriod } from '@sb/demo-data';
import { createTestDatabase, Database, type Commands } from '@sb/db';
import { buildApi } from '../../apps/api/src/index.js';
import { RentalWorker } from '../../apps/worker/src/worker.js';

export const origin = 'http://localhost:8000';
export type Actor = { cookie: string; csrf: string; userId: string };
export const fixture = (scenario: FixtureScenario = 'normal') =>
  createAiPorts({ AI_MODE: 'fixture' }, { scenario });
export async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 20_000,
): Promise<T> {
  const end = Date.now() + timeout;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await read();
    if (accept(last)) return last;
    await delay(50);
  }
  throw new Error(`Persisted outcome timed out: ${JSON.stringify(last)}`);
}
export function selectBody(view: C.RequestView, n: C.Negotiation): C.SelectOfferBody {
  return {
    expectedRequestVersion: view.request.version,
    negotiationId: n.id,
    expectedNegotiationVersion: n.version,
    offerId: n.offer!.id,
    termsRevision: n.termsRevision,
    acknowledgeCloseOtherBranches: true,
  };
}

/** Observe real COMMIT calls without replacing SQL/results; record a bound on commit time. */
class MeasuredDatabase extends Database {
  commits = new Map<string, { sent: number; acknowledged: number }>();
  override async transaction<T>(fn: (u: Commands) => Promise<T>, now?: Date): Promise<T> {
    return super.transaction(async (u) => {
      const original = u.c.query;
      const release = u.c.release;
      const keys: string[] = [];
      const commits = this.commits;
      u.c.query = async function (this: typeof u.c, ...args: unknown[]) {
        const sql = args[0];
        const values = args[1] as unknown[] | undefined;
        if (typeof sql === 'string' && sql.startsWith('INSERT INTO user_events') && values)
          keys.push(`${values[0]}:${values[1]}`);
        const sent = performance.now();
        const result = await Reflect.apply(original, this, args);
        if (sql === 'COMMIT')
          for (const key of keys) commits.set(key, { sent, acknowledged: performance.now() });
        return result;
      } as typeof u.c.query;
      // Restore before returning the connection to the pool so the next borrower cannot
      // inherit this transaction's observer or event IDs.
      u.c.release = (error) => {
        u.c.query = original;
        u.c.release = release;
        release(error);
      };
      return fn(u);
    }, now);
  }
}

export async function harness(
  options: {
    scenario?: C.DemoScenario;
    ai?: AiPorts;
    now?: () => Date;
    startWorker?: boolean;
  } = {},
) {
  const ai = options.ai ?? fixture();
  const now = options.now ?? (() => new Date());
  const privateDb = await createTestDatabase({
    now,
    fixture: buildSeed({ now: now(), scenario: options.scenario ?? 'default' }),
  });
  const db = new MeasuredDatabase({
    pool: privateDb.db.pool,
    now,
    feeRecommender: ai.feeRecommender,
  });
  const app = await buildApi({ db, appOrigin: origin, heartbeatMs: 100, rateLimitMax: 100_000 });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  let worker: RentalWorker | undefined;
  const actors: Record<string, Actor> = {};
  async function enter(handle: string, old?: Actor) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin, ...(old ? { cookie: old.cookie } : {}) },
      payload: { handle },
    });
    expect(r.statusCode, r.body).toBe(201);
    const data = C.DemoSessionDataSchema.parse(r.json().data);
    const actor = {
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      csrf: data.csrfToken,
      userId: data.user.id,
    };
    return actor;
  }
  async function api(
    who: string | Actor,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    key = randomUUID() as string,
  ) {
    const a = typeof who === 'string' ? actors[who]! : who;
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { origin, cookie: a.cookie, 'x-csrf-token': a.csrf, 'idempotency-key': key },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }
  async function fresh(id: string, who: string | Actor = 'hana') {
    const r = await api(who, 'GET', `/requests/${id}`);
    expect(r.statusCode, r.body).toBe(200);
    return C.RequestViewSchema.parse(r.json().data);
  }
  const need = (overrides: Partial<C.NeedDraft> = {}): C.NeedDraft => ({
    category: 'HOBBY',
    queryText: '프로젝터',
    ...defaultRequestPeriod(now()),
    preferredPlaceIds: ['place-center', 'place-station', 'place-library'],
    maxBudgetKrw: null,
    ...overrides,
  });
  async function create(who = 'hana', draft = need()) {
    const r = await api(who, 'POST', '/requests', { need: draft });
    expect(r.statusCode, r.body).toBe(201);
    return C.RequestViewSchema.parse(r.json().data);
  }
  async function search(who = 'hana', draft = need()) {
    const v = await create(who, draft);
    const r = await api(who, 'POST', `/requests/${v.request.id}/search`, {
      expectedRequestVersion: v.request.version,
    });
    expect(r.statusCode, r.body).toBe(202);
    return { view: v, taskId: r.json().data.taskId as string };
  }
  async function matches(who = 'hana', draft = need()) {
    const s = await search(who, draft);
    return until(
      () => fresh(s.view.request.id, who),
      (v) => ['MATCHES_READY', 'NO_MATCH', 'FAILED'].includes(v.request.status),
    );
  }
  function submitBody(view: C.RequestView, items: string[]) {
    return {
      expectedRequestVersion: view.request.version,
      selections: items.map((id) => {
        const c = view.candidates.find((c) => c.itemId === id)!;
        expect(c, id).toBeDefined();
        return { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw };
      }),
    };
  }
  async function submit(
    view: C.RequestView,
    items = ['pub-projector', 'res-projector-duri', 'res-projector-seul'],
    who = 'hana',
  ) {
    const r = await api(
      who,
      'POST',
      `/requests/${view.request.id}/submit`,
      submitBody(view, items),
    );
    expect(r.statusCode, r.body).toBe(201);
    return C.RequestViewSchema.parse(r.json().data);
  }
  async function response(
    n: C.Negotiation,
    action: 'APPROVE' | 'DECLINE' | 'COUNTER' = 'APPROVE',
    terms: C.Terms | null = null,
  ) {
    const who = n.ownerId!.replace('u_', '');
    const r = await api(who, 'POST', `/negotiations/${n.id}/owner-response`, {
      action,
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms,
      ...(action === 'DECLINE' ? { reasonCode: 'UNAVAILABLE' } : {}),
    });
    expect(r.statusCode, r.body).toBe(200);
    return C.OwnerCardSchema.parse(r.json().data).negotiation;
  }
  async function quote(
    n: C.Negotiation,
    who = 'hana',
    period = { startAt: n.terms.startAt, endAt: n.terms.endAt },
  ) {
    const r = await api(who, 'POST', '/price-quotes', {
      requestId: n.requestId,
      negotiationId: n.id,
      itemId: n.itemId,
      ...period,
    });
    expect(r.statusCode, r.body).toBe(200);
    return C.PricingQuoteSchema.parse(r.json().data);
  }
  async function select(view: C.RequestView, n: C.Negotiation, who: string | Actor = 'hana') {
    const r = await api(who, 'POST', `/requests/${view.request.id}/select`, selectBody(view, n));
    expect(r.statusCode, r.body).toBe(200);
    return {
      request: C.RequestViewSchema.parse(r.json().data.request),
      paymentPreview: C.PaymentPreviewSchema.parse(r.json().data.paymentPreview),
    };
  }
  async function startWorker(replacementAi = ai) {
    worker = new RentalWorker({
      db,
      ai: replacementAi,
      dispatchIntervalMs: 50,
      recoveryIntervalMs: 300,
      expiryIntervalMs: 100,
    });
    await worker.start();
    return worker;
  }
  async function stopWorker() {
    await worker?.stop();
    worker = undefined;
  }
  async function sync(who: string | Actor = 'hana') {
    return C.SyncDataSchema.parse((await api(who, 'GET', '/sync')).json().data);
  }
  for (const who of ['hana', 'duri', 'seul', 'jun']) actors[who] = await enter(`demo-${who}`);
  if (options.startWorker !== false) await startWorker();
  return {
    db,
    app,
    base,
    actors,
    enter,
    api,
    fresh,
    need,
    create,
    search,
    matches,
    submitBody,
    submit,
    response,
    quote,
    select,
    sync,
    startWorker,
    stopWorker,
    get worker() {
      return worker!;
    },
    close: async () => {
      await stopWorker();
      await app.close();
      await privateDb.cleanup();
    },
  };
}
export type Harness = Awaited<ReturnType<typeof harness>>;
export type ReceivedEvent = {
  type: string;
  id?: string;
  data: Record<string, unknown>;
  received: number;
};
export async function stream(h: Harness, who: string | Actor = 'hana', after = '0', last?: string) {
  const a = typeof who === 'string' ? h.actors[who]! : who;
  const abort = new AbortController();
  const r = await fetch(`${h.base}/api/v1/events?after=${after}`, {
    headers: { cookie: a.cookie, ...(last ? { 'Last-Event-ID': last } : {}) },
    signal: abort.signal,
  });
  expect(r.status).toBe(200);
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  const events: ReceivedEvent[] = [];
  let buffer = '';
  const reading = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const lines = buffer.slice(0, i).split('\n');
          buffer = buffer.slice(i + 2);
          const type = lines.find((l) => l.startsWith('event: '))?.slice(7);
          const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
          const id = lines.find((l) => l.startsWith('id: '))?.slice(4);
          if (type && data)
            events.push({
              type,
              ...(id ? { id } : {}),
              data: JSON.parse(data) as Record<string, unknown>,
              received: performance.now(),
            });
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) throw e;
    }
  })();
  return {
    events,
    wait: (predicate: (e: ReceivedEvent) => boolean, timeout = 5000) =>
      until(
        async () => events.find(predicate),
        (e) => !!e,
        timeout,
      ).then((e) => e!),
    close: async () => {
      abort.abort();
      await reader.cancel().catch(() => {});
      await reading;
    },
  };
}
