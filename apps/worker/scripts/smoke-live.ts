import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createAiPorts } from '@sb/ai';
import { buildApi } from '@sb/api';
import { createTestDatabase } from '@sb/db';
import { defaultRequestPeriod } from '@sb/demo-data';
import {
  createEmptyNeed,
  type DemoSessionData,
  type RequestView,
  type PricingQuote,
} from '@sb/contracts';
import { RentalWorker, classifyError } from '../src/worker.js';

// Always use a private, migrated/seeded database; never reset the shared development DB.
if (process.env.AI_MODE !== 'live') throw new Error('Run with AI_MODE=live');
const ai = createAiPorts(process.env);
const test = await createTestDatabase();
const db = test.db;
const origin = 'http://127.0.0.1:3101';
const app = await buildApi({
  db,
  appOrigin: origin,
  cookieName: 'worker_smoke_session',
  cookieSecure: false,
});
const events: Record<string, unknown>[] = [];
const worker = new RentalWorker({
  db,
  ai,
  log: (event, fields) => events.push({ at: new Date().toISOString(), event, ...fields }),
});
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  aiMode: 'live',
  models: {
    agent: process.env.OPENAI_AGENT_MODEL ?? 'gpt-6.1-terra',
    decision: process.env.OPENAI_DECISION_MODEL ?? 'gpt-6-luna',
  },
  apiOrigin: origin,
  isolatedDatabase: true,
};
let cookie = '';
let csrf = '';
async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': randomUUID() } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json()) as { data: T; error?: { code: string } };
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload.error?.code ?? 'unknown'}`);
  if (path === '/demo-sessions') cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  return payload.data;
}
async function waitFor(
  requestId: string,
  predicate: (v: RequestView) => boolean,
): Promise<RequestView> {
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    const v = await call<RequestView>(`/requests/${requestId}`);
    if (predicate(v)) return v;
    await delay(200);
  }
  throw new Error('Live smoke deadline exceeded');
}
try {
  await app.listen({ host: '127.0.0.1', port: 3101 });
  await worker.start();
  const session = await call<DemoSessionData>('/demo-sessions', 'POST', { handle: 'demo-hana' });
  csrf = session.csrfToken;
  const draft = await call<RequestView>('/requests', 'POST', { need: createEmptyNeed() });
  const confirmed = await call<RequestView>(`/requests/${draft.request.id}/draft`, 'PATCH', {
    expectedRequestVersion: draft.request.version,
    need: {
      category: 'HOBBY',
      queryText: '프로젝터',
      ...defaultRequestPeriod(),
      preferredPlaceIds: ['place-center', 'place-station', 'place-library'],
      maxBudgetKrw: null,
    },
  });
  await call(`/requests/${draft.request.id}/search`, 'POST', {
    expectedRequestVersion: confirmed.request.version,
  });
  const found = await waitFor(draft.request.id, (v) => v.request.status === 'MATCHES_READY');
  const quotes = (
    await db.pool.query<{ data: PricingQuote }>(
      'SELECT data FROM pricing_quotes WHERE request_id=$1 ORDER BY id',
      [draft.request.id],
    )
  ).rows.map((r) => r.data);
  assert(quotes.some((q) => q.itemId.startsWith('res-')));
  assert(quotes.find((q) => q.itemId === 'pub-projector')?.recommendationSource === 'PUBLIC_FIXED');
  const candidate = found.candidates.find((c) => c.itemId === 'pub-projector')!;
  const sent = await call<RequestView>(`/requests/${draft.request.id}/submit`, 'POST', {
    expectedRequestVersion: found.request.version,
    selections: [
      {
        candidateId: candidate.id,
        quoteId: candidate.quoteId,
        totalFeeKrw: candidate.suggestedTerms.totalFeeKrw,
      },
    ],
  });
  assert.equal(sent.negotiations[0]?.status, 'PENDING_PUBLIC');
  const offered = await waitFor(draft.request.id, (v) => v.negotiations[0]?.status === 'OFFERED');
  assert.equal(offered.negotiations[0]?.offer?.endorsedBy, 'PUBLIC_DEMO');
  assert(!JSON.stringify(offered).includes('externalApplicationId'));
  Object.assign(report, {
    outcome: 'succeeded',
    requestId: draft.request.id,
    states: [
      'DRAFT',
      'SEARCHING',
      found.request.status,
      sent.request.status,
      offered.negotiations[0]!.status,
    ],
    quotes,
    searchResponse: found,
    publicResponse: offered,
  });
  console.log(
    JSON.stringify(
      {
        outcome: 'succeeded',
        requestId: draft.request.id,
        search: found.request.status,
        public: offered.negotiations[0]!.status,
        quotes: quotes.map((q) => ({
          itemId: q.itemId,
          recommendationSource: q.recommendationSource,
          recommendedKrw: q.recommendedKrw,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  Object.assign(report, { outcome: 'failed', error: classifyError(error) });
  console.error(JSON.stringify({ outcome: 'failed', error: classifyError(error) }));
  process.exitCode = 1;
} finally {
  await worker.stop();
  await app.close();
  await test.cleanup();
  Object.assign(report, { finishedAt: new Date().toISOString(), events });
  const directory = new URL('../reports/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const path = new URL(`live-${new Date().toISOString().replaceAll(':', '-')}.json`, directory);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${path.pathname}`);
}
