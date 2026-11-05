import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  createEmptyNeed,
  INTAKE_APPROVAL_MAX_ATTEMPTS as MAX_INTAKE_ATTEMPTS,
  IntakeApprovalSchema,
  RequestViewSchema,
  type ExtractNeedResult,
  type IntakeApproval,
  type RequestView,
} from '@sb/contracts';
import { Commands, DomainError, createTestDatabase, type Database } from '@sb/db';
import { buildApi } from '../index.js';
import { backoffMs, pickCandidates } from './index.js';

process.env.AI_MODE = 'fixture';
type Actor = { cookie: string; csrf: string };
const origin = 'http://localhost:8000';
let app: FastifyInstance, db: Database, cleanup: () => Promise<void>;
let hana: Actor, duri: Actor;

const call = (
  actor: Actor,
  method: 'GET' | 'POST',
  path: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie: actor.cookie, 'x-csrf-token': actor.csrf, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const enter = async (handle: string): Promise<Actor> => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle },
  });
  return {
    cookie: `${res.cookies[0]!.name}=${res.cookies[0]!.value}`,
    csrf: res.json().data.csrfToken as string,
  };
};
const completeNeed = (): ExtractNeedResult => {
  const start = Math.ceil((Date.now() + 86_400_000) / 1_800_000) * 1_800_000;
  return {
    proposedNeed: {
      category: 'HOBBY',
      queryText: '프로젝터',
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 86_400_000).toISOString(),
      preferredPlaceIds: ['place-center'],
      maxBudgetKrw: null,
    },
    missingFields: [],
    clarificationQuestion: null,
  };
};
/** The same proposal path a voice call uses (agent turn → route → extraction), driven without a model. */
async function collected(result = completeNeed()) {
  const view: RequestView = (
    await call(hana, 'POST', '/requests', { need: createEmptyNeed() })
  ).json().data;
  const res = await call(hana, 'POST', '/agent-turns', {
    requestId: view.request.id,
    expectedRequestVersion: view.request.version,
    text: '내일부터 하루 프로젝터를 센터에서 빌릴게요.',
  });
  expect(res.statusCode, res.body).toBe(202);
  const tasks = async () =>
    (await db.sync('u_hana')).tasks.filter((t) => t.requestId === view.request.id);
  const route = (await tasks())[0]!;
  await db.startTask(route.id);
  await db.recordTaskResult(route.id, route.inputVersion, { intent: 'RENTAL_REQUEST' });
  const extract = (await tasks()).find((t) => t.kind === 'EXTRACT_NEED')!;
  await db.startTask(extract.id);
  await db.recordTaskResult(extract.id, extract.inputVersion, result);
  const latest = RequestViewSchema.parse(
    (await call(hana, 'GET', `/requests/${view.request.id}`)).json().data,
  );
  return { view: latest, extractionTaskId: extract.id };
}
const approve = (view: RequestView, extractionTaskId: string, key = randomUUID()) =>
  call(
    hana,
    'POST',
    '/intake-approvals',
    {
      requestId: view.request.id,
      extractionTaskId,
      expectedRequestVersion: view.request.version,
    },
    key,
  );
const status = async (id: string): Promise<IntakeApproval> =>
  IntakeApprovalSchema.parse((await call(hana, 'GET', `/intake-approvals/${id}`)).json().data);

beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, rateLimitMax: 10_000 });
  hana = await enter('demo-hana');
  duri = await enter('demo-duri');
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app.close();
  await cleanup();
});

describe('request_reservation tool after human approval', () => {
  it('confirms the approved need, searches, then submits to the best available items', async () => {
    const { view, extractionTaskId } = await collected();
    const res = await approve(view, extractionTaskId);
    expect(res.statusCode, res.body).toBe(202);
    const job = IntakeApprovalSchema.parse(res.json().data);
    expect(job).toMatchObject({ tool: 'request_reservation', status: 'SEARCHING', step: 'SUBMIT' });
    expect(job.need.queryText).toBe('프로젝터');

    // Duplicate approval (new key, e.g. background retry after a lost response) returns the same job.
    const again = await approve(view, extractionTaskId);
    expect(again.json().data.id).toBe(job.id);

    // The worker's SEARCH runs, then the background loop submits.
    const searching = RequestViewSchema.parse(
      (await call(hana, 'GET', `/requests/${view.request.id}`)).json().data,
    );
    expect(searching.request.status).toBe('SEARCHING');
    expect(searching.request.need).toEqual(job.need);
    expect(
      await db.runSearch(view.request.id, {
        kind: 'NEED',
        needRevision: searching.request.needRevision,
      }),
    ).toBe(true);
    const matched = RequestViewSchema.parse(
      (await call(hana, 'GET', `/requests/${view.request.id}`)).json().data,
    );
    expect(
      matched.request.status,
      JSON.stringify(
        matched.candidates.map((c) => [c.itemId, c.availability, c.unavailableReason]),
      ),
    ).toBe('MATCHES_READY');
    await db.pool.query(
      "UPDATE intake_approvals SET next_attempt_at=now() - interval '1 second' WHERE id=$1",
      [job.id],
    );
    await app.intakeApprovals.tick();
    const done = await status(job.id);
    expect(done.status, JSON.stringify(done)).toBe('SUBMITTED');
    const after = RequestViewSchema.parse(
      (await call(hana, 'GET', `/requests/${view.request.id}`)).json().data,
    );
    expect(after.request.status).toBe('COLLECTING_OFFERS');
    expect(after.negotiations.map((n) => n.itemId).sort()).toEqual([
      'pub-projector',
      'res-projector-duri',
    ]);
    expect(done.negotiationIds.sort()).toEqual(after.negotiations.map((n) => n.id).sort());
  });

  it('keeps the job when the first tool call fails and retries it in the background', async () => {
    const { view, extractionTaskId } = await collected();
    const spy = vi
      .spyOn(Commands.prototype, 'confirmAndSearch')
      .mockRejectedValueOnce(new DomainError('TEMPORARILY_UNAVAILABLE'));
    const res = await approve(view, extractionTaskId);
    expect(res.statusCode, res.body).toBe(202);
    const job = IntakeApprovalSchema.parse(res.json().data);
    expect(job).toMatchObject({
      status: 'RETRYING',
      attempts: 1,
      lastErrorCode: 'TEMPORARILY_UNAVAILABLE',
    });
    // Rolled back to the savepoint: the draft is untouched by the failed call.
    const untouched = RequestViewSchema.parse(
      (await call(hana, 'GET', `/requests/${view.request.id}`)).json().data,
    );
    expect(untouched.request.status).toBe('DRAFT');
    await db.pool.query(
      "UPDATE intake_approvals SET next_attempt_at=now() - interval '1 second' WHERE id=$1",
      [job.id],
    );
    await app.intakeApprovals.tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await status(job.id)).toMatchObject({ status: 'SEARCHING', attempts: 0 });
  });

  it('stops retrying after the attempt limit and tells the requester to continue manually', async () => {
    const { view, extractionTaskId } = await collected();
    vi.spyOn(Commands.prototype, 'confirmAndSearch').mockRejectedValue(
      new DomainError('TEMPORARILY_UNAVAILABLE'),
    );
    const job = IntakeApprovalSchema.parse((await approve(view, extractionTaskId)).json().data);
    expect(job.status).toBe('RETRYING');
    // 명세 0004: 연속 실패 상한 직전으로 맞춘 뒤 한 번 더 실패하면 FAILED + 알림.
    await db.pool.query(
      `UPDATE intake_approvals SET data=jsonb_set(data,'{attempts}',to_jsonb($2::int)), next_attempt_at=now() - interval '1 second' WHERE id=$1`,
      [job.id, MAX_INTAKE_ATTEMPTS - 1],
    );
    await app.intakeApprovals.tick();
    const failed = await status(job.id);
    expect(failed).toMatchObject({
      status: 'FAILED',
      attempts: MAX_INTAKE_ATTEMPTS,
      lastErrorCode: 'TEMPORARILY_UNAVAILABLE',
      nextAttemptAt: null,
    });
    const notifications = (await call(hana, 'GET', '/notifications')).json().data;
    expect(notifications.items[0]).toMatchObject({
      type: 'INTAKE_FAILED',
      requestId: view.request.id,
      link: `/requests/${view.request.id}`,
    });
    // 종료 상태는 더 이상 재시도하지 않는다.
    await db.pool.query(
      "UPDATE intake_approvals SET next_attempt_at=now() - interval '1 second' WHERE id=$1",
      [job.id],
    );
    await app.intakeApprovals.tick();
    expect((await status(job.id)).attempts).toBe(MAX_INTAKE_ATTEMPTS);
  });

  it('rejects incomplete collections, foreign requests, and non-extraction tasks', async () => {
    const incomplete = completeNeed();
    incomplete.proposedNeed.preferredPlaceIds = [];
    incomplete.missingFields = ['preferredPlaceIds'];
    incomplete.clarificationQuestion = '어디에서 받으실까요?';
    const partial = await collected(incomplete);
    expect((await approve(partial.view, partial.extractionTaskId)).statusCode).toBe(422);

    const { view, extractionTaskId } = await collected();
    const foreign = await call(duri, 'POST', '/intake-approvals', {
      requestId: view.request.id,
      extractionTaskId,
      expectedRequestVersion: view.request.version,
    });
    expect(foreign.statusCode).toBe(404);
    const route = (await db.sync('u_hana')).tasks.find(
      (t) => t.requestId === view.request.id && t.kind === 'ROUTE_INTENT',
    )!;
    expect((await approve(view, route.id)).statusCode).toBe(409);
    const stale = await call(hana, 'POST', '/intake-approvals', {
      requestId: view.request.id,
      extractionTaskId,
      expectedRequestVersion: view.request.version + 1,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('prefers center items, then the lowest fee, at most three', () => {
    const c = (id: string, source: 'PUBLIC' | 'RESIDENT', fee: number, available = true) =>
      ({
        id,
        availability: available ? 'AVAILABLE' : 'UNAVAILABLE',
        itemSummary: { source },
        suggestedTerms: { totalFeeKrw: fee },
      }) as never;
    expect(
      pickCandidates([
        c('a', 'RESIDENT', 500),
        c('b', 'PUBLIC', 3000),
        c('c', 'RESIDENT', 100, false),
        c('d', 'RESIDENT', 200),
        c('e', 'RESIDENT', 900),
      ]).map((v: { id: string }) => v.id),
    ).toEqual(['b', 'd', 'a']);
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 60000]);
  });
});
