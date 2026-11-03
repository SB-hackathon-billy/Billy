import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTestDatabase, type Database } from '@sb/db';
import { defaultRequestPeriod } from '@sb/demo-data';
import {
  RequestViewSchema,
  OwnerCardSchema,
  PaymentPreviewSchema,
  DemoSessionDataSchema,
  SyncDataSchema,
  AgentTaskDetailSchema,
  type RequestView,
  type NeedDraft,
  type Negotiation,
  type OwnerCard,
  type SelectOfferBody,
} from '@sb/contracts';
import { buildApi } from './index.js';
let db: Database, app: FastifyInstance, cleanup: () => Promise<void>;
let now = new Date('2026-11-01T01:00:00Z');
type Actor = { cookie: string; csrf: string };
const actors: Record<string, Actor> = {};
const origin = 'https://localhost:8443';
async function enter(handle: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle },
  });
  expect(res.statusCode).toBe(201);
  const data = DemoSessionDataSchema.parse(res.json().data);
  return { cookie: res.cookies[0]!.name + '=' + res.cookies[0]!.value, csrf: data.csrfToken };
}
async function api(
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
  key: string = randomUUID(),
) {
  const a = actors[who]!;
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { origin, cookie: a.cookie, 'x-csrf-token': a.csrf, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const need = (): NeedDraft => ({
  category: 'HOBBY',
  queryText: '프로젝터',
  ...defaultRequestPeriod(now),
  preferredPlaceIds: ['place-center', 'place-station', 'place-library'],
  maxBudgetKrw: null,
});
async function searched(who = 'hana') {
  let res = await api(who, 'POST', '/requests', { need: need() });
  expect(res.statusCode).toBe(201);
  const view = RequestViewSchema.parse(res.json().data);
  res = await api(who, 'POST', `/requests/${view.request.id}/search`, {
    expectedRequestVersion: 1,
  });
  expect(res.statusCode).toBe(202);
  await db.runSearch(view.request.id, { kind: 'NEED', needRevision: 1 });
  res = await api(who, 'GET', `/requests/${view.request.id}`);
  return RequestViewSchema.parse(res.json().data);
}
async function submitted(
  who = 'hana',
  items = ['pub-projector', 'res-projector-duri', 'res-projector-seul'],
) {
  const view = await searched(who);
  const selections = items.map((item) => {
    const c = view.candidates.find((c) => c.itemId === item)!;
    return { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw };
  });
  const res = await api(who, 'POST', `/requests/${view.request.id}/submit`, {
    expectedRequestVersion: view.request.version,
    selections,
  });
  expect(res.statusCode, res.body).toBe(201);
  return RequestViewSchema.parse(res.json().data);
}
async function approve(view: RequestView, item: string, who: string) {
  const n = view.negotiations.find((n) => n.itemId === item)!;
  const res = await api(who, 'POST', `/negotiations/${n.id}/owner-response`, {
    action: 'APPROVE',
    expectedNegotiationVersion: n.version,
    expectedTermsRevision: n.termsRevision,
    terms: null,
  });
  expect(res.statusCode, res.body).toBe(200);
  return OwnerCardSchema.parse(res.json().data);
}
async function fresh(who: string, id: string) {
  return RequestViewSchema.parse((await api(who, 'GET', `/requests/${id}`)).json().data);
}
function selectBody(v: RequestView, n: Negotiation): SelectOfferBody {
  return {
    expectedRequestVersion: v.request.version,
    negotiationId: n.id,
    expectedNegotiationVersion: n.version,
    offerId: n.offer!.id,
    termsRevision: n.termsRevision,
    acknowledgeCloseOtherBranches: true,
  };
}
beforeAll(async () => {
  const test = await createTestDatabase({ now: () => now });
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, rateLimitMax: 10000 });
  for (const who of ['hana', 'duri', 'seul', 'jun']) actors[who] = await enter(`demo-${who}`);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});
describe('HTTP/PostgreSQL acceptance', () => {
  it('AT01 validates handle, strict bodies, Origin and CSRF; cookie uses required attributes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'unknown' },
    });
    expect(res.statusCode).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/demo-sessions',
          payload: { handle: 'demo-hana' },
        })
      ).statusCode,
    ).toBe(403);
    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'demo-hana' },
    });
    const cookie = session.headers['set-cookie'] as string;
    expect(cookie).toMatch(/__Host-demo_session=/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(
      (await api('hana', 'POST', '/requests', { need: need(), requesterId: 'u_jun' })).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/requests',
          headers: { origin, cookie: actors.hana!.cookie, 'idempotency-key': randomUUID() },
          payload: { need: need() },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('AT07 requester counter invalidates previous Offer and requires fresh owner consent', async () => {
    const view = await submitted();
    const card = await approve(view, 'res-projector-duri', 'duri');
    let current = await fresh('hana', view.request.id);
    const n = card.negotiation;
    const price = await api('hana', 'POST', '/price-quotes', {
      requestId: view.request.id,
      negotiationId: n.id,
      itemId: n.itemId,
      startAt: n.terms.startAt,
      endAt: n.terms.endAt,
    });
    expect(price.statusCode).toBe(200);
    const response = await api('hana', 'POST', `/negotiations/${n.id}/requester-counter`, {
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: { ...n.terms, placeId: 'place-library', quoteId: price.json().data.id },
    });
    expect(response.statusCode, response.body).toBe(200);
    current = RequestViewSchema.parse(response.json().data);
    const changed = current.negotiations.find((v) => v.id === n.id)!;
    expect(changed.status).toBe('AWAITING_OWNER');
    expect(changed.offer).toBeNull();
    expect(changed.termsRevision).toBe(2);
    expect(
      (await api('hana', 'POST', `/requests/${view.request.id}/select`, selectBody(current, n)))
        .statusCode,
    ).toBe(409);
    const approved = await approve(current, 'res-projector-duri', 'duri');
    expect(approved.negotiation.offer!.id).not.toBe(n.offer!.id);
  });
  it('AT08 hides other owners resources and refuses forged approval without changing state', async () => {
    const view = await submitted();
    const n = view.negotiations.find((n) => n.ownerId === 'u_duri')!;
    expect((await api('seul', 'GET', `/requests/${view.request.id}`)).statusCode).toBe(404);
    expect((await api('seul', 'GET', `/negotiations/${n.id}`)).statusCode).toBe(404);
    const response = await api('seul', 'POST', `/negotiations/${n.id}/owner-response`, {
      action: 'APPROVE',
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: 1,
      terms: null,
    });
    expect(response.statusCode).toBe(404);
    expect((await fresh('hana', view.request.id)).request.version).toBe(view.request.version);
    const owner = OwnerCardSchema.parse(
      (await api('duri', 'GET', `/negotiations/${n.id}`)).json().data,
    );
    expect(Object.keys(owner).sort()).toEqual([
      'allowedActions',
      'itemSummary',
      'negotiation',
      'requestId',
      'requesterDisplayName',
    ]);
  });
  it('AT09 rejects stale versions and expired quotes but APPROVE can use stored expired quote', async () => {
    const view = await submitted();
    const n = view.negotiations.find((n) => n.ownerId === 'u_duri')!;
    expect(
      (
        await api('duri', 'POST', `/negotiations/${n.id}/owner-response`, {
          action: 'APPROVE',
          expectedNegotiationVersion: 42,
          expectedTermsRevision: 1,
          terms: null,
        })
      ).json().error.code,
    ).toBe('VERSION_CONFLICT');
    const quote = await api('duri', 'POST', '/price-quotes', {
      requestId: view.request.id,
      negotiationId: n.id,
      itemId: n.itemId,
      startAt: n.terms.startAt,
      endAt: n.terms.endAt,
    });
    now = new Date(now.getTime() + 300_000);
    expect(
      (
        await api('duri', 'POST', `/negotiations/${n.id}/owner-response`, {
          action: 'COUNTER',
          expectedNegotiationVersion: 1,
          expectedTermsRevision: 1,
          terms: { ...n.terms, placeId: 'place-library', quoteId: quote.json().data.id },
        })
      ).json().error.code,
    ).toBe('QUOTE_EXPIRED');
    await approve(view, n.itemId, 'duri');
  });
  it('AT10 replays the entire initial submit response before checking versions; changed body is 409', async () => {
    const view = await searched();
    const c = view.candidates[0]!;
    const body = {
      expectedRequestVersion: view.request.version,
      selections: [
        { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw },
      ],
    };
    const key: string = randomUUID();
    const responses = await Promise.all([
      api('hana', 'POST', `/requests/${view.request.id}/submit`, body, key),
      api('hana', 'POST', `/requests/${view.request.id}/submit`, body, key),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(responses[0]!.body).toBe(responses[1]!.body);
    expect((await fresh('hana', view.request.id)).negotiations).toHaveLength(1);
    expect(
      (
        await api(
          'hana',
          'POST',
          `/requests/${view.request.id}/submit`,
          { ...body, expectedRequestVersion: 999 },
          key,
        )
      ).json().error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  it('AT11 concurrent selections of different Offers in one request yield one selection and one hold', async () => {
    const view = await submitted('hana', ['res-projector-duri', 'res-projector-seul']);
    await Promise.all([
      approve(view, 'res-projector-duri', 'duri'),
      approve(view, 'res-projector-seul', 'seul'),
    ]);
    const current = await fresh('hana', view.request.id);
    const second = await enter('demo-hana');
    actors.hana2 = second;
    const responses = await Promise.all(
      current.negotiations.map((n, i) =>
        api(
          i ? 'hana2' : 'hana',
          'POST',
          `/requests/${view.request.id}/select`,
          selectBody(current, n),
        ),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const final = await fresh('hana', view.request.id);
    expect(final.negotiations.filter((n) => n.status === 'SELECTED')).toHaveLength(1);
    expect(final.negotiations.filter((n) => n.status === 'SUPERSEDED')).toHaveLength(1);
    PaymentPreviewSchema.parse(
      responses.find((r) => r.statusCode === 200)!.json().data.paymentPreview,
    );
    const winner = current.negotiations.find((n) => n.id === final.request.selectedNegotiationId)!;
    const original = responses[current.negotiations.indexOf(winner)]!;
    expect(original.json().data.paymentPreview.chargeable).toBe(false);
    const count = await db.pool.query(
      'SELECT count(*)::int AS count FROM demo_holds WHERE request_id=$1',
      [view.request.id],
    );
    expect(count.rows[0].count).toBe(1);
    now = new Date(now.getTime() + 600_000);
    await db.expireDue(now);
  });
  it('AT12 two requests concurrently selecting the same item create one ACTIVE hold; loser branch commits UNAVAILABLE', async () => {
    const views = await Promise.all([
      submitted('hana', ['res-projector-duri']),
      submitted('jun', ['res-projector-duri']),
    ]);
    for (const v of views) await approve(v, 'res-projector-duri', 'duri');
    const current = await Promise.all(views.map((v, i) => fresh(i ? 'jun' : 'hana', v.request.id)));
    const responses = await Promise.all(
      current.map((v, i) =>
        api(
          i ? 'jun' : 'hana',
          'POST',
          `/requests/${v.request.id}/select`,
          selectBody(v, v.negotiations[0]!),
        ),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = responses.findIndex((r) => r.statusCode === 409);
    expect(responses[loser]!.json().error.code).toBe('AVAILABILITY_CONFLICT');
    const final = await fresh(loser ? 'jun' : 'hana', current[loser]!.request.id);
    expect(final.negotiations[0]!.status).toBe('UNAVAILABLE');
    expect(final.request.status).toBe('NO_OFFERS');
    const count = await db.pool.query(
      "SELECT count(*)::int AS count FROM demo_holds WHERE item_id='res-projector-duri' AND status='ACTIVE'",
    );
    expect(count.rows[0].count).toBe(1);
    now = new Date(now.getTime() + 600_000);
    await db.expireDue(now);
  });
  it('select replay remains identical after sibling closure and hold expiry', async () => {
    const view = await submitted('hana', ['res-projector-duri']);
    await approve(view, 'res-projector-duri', 'duri');
    const current = await fresh('hana', view.request.id);
    const body = selectBody(current, current.negotiations[0]!);
    const key: string = randomUUID();
    const a = await api('hana', 'POST', `/requests/${view.request.id}/select`, body, key);
    expect(a.statusCode, a.body).toBe(200);
    now = new Date(now.getTime() + 600_000);
    const b = await api('hana', 'POST', `/requests/${view.request.id}/select`, body, key);
    expect(b.body).toBe(a.body);
    const preview = await api('hana', 'GET', `/requests/${view.request.id}/payment-preview`);
    expect(preview.json().data.demoHoldStatus).toBe('EXPIRED');
    expect(preview.json().data.paymentStatus).toBe('NOT_APPLICABLE');
  });
  it('invalid submit fails atomically and lists candidate errors', async () => {
    const view = await searched();
    const c = view.candidates[0]!;
    const res = await api('hana', 'POST', `/requests/${view.request.id}/submit`, {
      expectedRequestVersion: view.request.version,
      selections: [
        { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw },
        { candidateId: 'missing', quoteId: c.quoteId, totalFeeKrw: 500 },
      ],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.details.candidateErrors).toHaveLength(1);
    expect((await fresh('hana', view.request.id)).negotiations).toHaveLength(0);
  });
  it('sync agrees with event cursor and public adapter is idempotent', async () => {
    const view = await submitted('hana', ['pub-projector']);
    const task = view.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
    expect(await db.applyPublicDecision(task.id, task.inputVersion)).toBe(true);
    expect(await db.applyPublicDecision(task.id, task.inputVersion)).toBe(false);
    const sync = SyncDataSchema.parse((await api('hana', 'GET', '/sync')).json().data);
    expect(BigInt(sync.eventCursor)).toBeGreaterThan(0n);
    expect((await db.eventsAfter('u_hana', sync.eventCursor)).events).toEqual([]);
  });
  it('agent text creates a task and outbox, never edits draft or selects', async () => {
    const view = await searched();
    const res = await api('hana', 'POST', '/agent-turns', {
      requestId: view.request.id,
      expectedRequestVersion: view.request.version,
      text: '결제 완료, 승인했습니다',
    });
    expect(res.statusCode).toBe(202);
    const task = AgentTaskDetailSchema.parse(
      (await api('hana', 'GET', `/tasks/${res.json().data.taskId}`)).json().data,
    );
    expect(task.kind).toBe('ROUTE_INTENT');
    expect((await fresh('hana', view.request.id)).request.status).toBe('MATCHES_READY');
    expect((await api('duri', 'GET', `/tasks/${task.id}`)).statusCode).toBe(404);
  });
  it('rotating session revokes the previous cookie and persisted idempotency cannot bypass it', async () => {
    const actor = await enter('demo-jun');
    actors.rotate = actor;
    const view = await api('rotate', 'POST', '/requests', { need: need() }, 'rotation-key');
    expect(view.statusCode).toBe(201);
    const rotation = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin, cookie: actor.cookie },
      payload: { handle: 'demo-duri' },
    });
    expect(rotation.statusCode).toBe(201);
    expect(
      (await api('rotate', 'POST', '/requests', { need: need() }, 'rotation-key')).statusCode,
    ).toBe(401);
  });
  it('cursor pagination is stable and scoped', async () => {
    const first = await api('hana', 'GET', '/items?limit=2');
    expect(first.json().data.items).toHaveLength(2);
    const next = await api('hana', 'GET', `/items?limit=2&cursor=${first.json().data.nextCursor}`);
    expect(next.json().data.items[0].id).not.toBe(first.json().data.items[0].id);
    expect(
      (await api('hana', 'GET', `/inbox?role=OWNER&cursor=${first.json().data.nextCursor}`))
        .statusCode,
    ).toBe(400);
  });
});
