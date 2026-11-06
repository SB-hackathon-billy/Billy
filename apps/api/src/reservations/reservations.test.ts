// 3번 탐색·예약·대기·알림 HTTP 테스트. 명세: docs/specs/0004-reservations-waitlist-notifications.md
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  CatalogItemDetailSchema,
  CatalogItemSchema,
  DemoSessionDataSchema,
  ItemAvailabilitySchema,
  NotificationListSchema,
  RequestViewSchema,
  ReservationViewSchema,
  WaitlistEntrySchema,
  listDataSchema,
  type NeedDraft,
  type ReservationView,
  type WaitlistEntry,
} from '@sb/contracts';
import { createTestDatabase, sweepReservations, type Database } from '@sb/db';
import { buildApi } from '../index.js';

let db: Database, app: FastifyInstance, cleanup: () => Promise<void>;
let now = new Date('2026-11-02T01:00:00Z');
type Actor = { cookie: string; csrf: string };
const actors: Record<string, Actor> = {};
const origin = 'http://localhost:8000';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function enter(handle: string): Promise<Actor> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle },
  });
  expect(res.statusCode).toBe(201);
  const data = DemoSessionDataSchema.parse(res.json().data);
  return { cookie: `${res.cookies[0]!.name}=${res.cookies[0]!.value}`, csrf: data.csrfToken };
}
function api(
  who: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
  key = randomUUID(),
) {
  const a = actors[who]!;
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie: a.cookie, 'x-csrf-token': a.csrf, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
/** 30분 단위 기간: 지금부터 startHours 뒤 시작, hours 동안. */
function period(startHours: number, hours: number) {
  const start = Math.ceil((now.getTime() + startHours * HOUR) / 1_800_000) * 1_800_000;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + hours * HOUR).toISOString(),
  };
}
const view = (body: string) => ReservationViewSchema.parse(JSON.parse(body).data);
async function reserve(
  who: string,
  itemId: string,
  p: { startAt: string; endAt: string },
  placeId: string,
) {
  return api(who, 'POST', '/reservations', { itemId, placeId, ...p });
}
async function reserved(
  who: string,
  itemId: string,
  p: { startAt: string; endAt: string },
  placeId: string,
) {
  const res = await reserve(who, itemId, p, placeId);
  expect(res.statusCode, res.body).toBe(201);
  return view(res.body);
}
async function respond(who: string, v: ReservationView, action: 'APPROVE' | 'DECLINE') {
  return api(who, 'POST', `/reservations/${v.reservation.id}/respond`, {
    action,
    expectedVersion: v.reservation.version,
    ...(action === 'DECLINE' ? { reasonCode: 'UNAVAILABLE' } : {}),
  });
}
async function get(who: string, id: string) {
  const res = await api(who, 'GET', `/reservations/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return view(res.body);
}
async function waitlist(who: string): Promise<WaitlistEntry[]> {
  const res = await api(who, 'GET', '/waitlist-entries');
  return listDataSchema(WaitlistEntrySchema).parse(res.json().data).items;
}
async function notifications(who: string) {
  const res = await api(who, 'GET', '/notifications');
  expect(res.statusCode, res.body).toBe(200);
  return NotificationListSchema.parse(res.json().data);
}

beforeAll(async () => {
  const test = await createTestDatabase({ now: () => now });
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, rateLimitMax: 10_000 });
  for (const who of ['hana', 'duri', 'seul', 'jun']) actors[who] = await enter(`demo-${who}`);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});

describe('3번 catalog', () => {
  it('lists enabled items with filters and period availability; hides disabled items', async () => {
    const all = await api('hana', 'GET', '/catalog?limit=50');
    expect(all.statusCode, all.body).toBe(200);
    const items = listDataSchema(CatalogItemSchema).parse(all.json().data).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain('pub-projector');
    expect(ids).toContain('res-projector-duri');
    expect(ids).not.toContain('res-case-seul'); // enabled=false
    expect(ids.indexOf('pub-cleaner')).toBeLessThan(ids.indexOf('res-cleaner-duri')); // 공공 먼저
    expect(items.find((i) => i.id === 'res-tool-hana')!.mine).toBe(true);

    const p = period(48, 26);
    const filtered = await api(
      'hana',
      'GET',
      `/catalog?q=${encodeURIComponent('프로젝터')}&startAt=${p.startAt}&endAt=${p.endAt}`,
    );
    const projectors = listDataSchema(CatalogItemSchema).parse(filtered.json().data).items;
    expect(projectors.map((i) => i.id).sort()).toEqual([
      'pub-projector',
      'res-projector-duri',
      'res-projector-seul',
    ]);
    const duriProjector = projectors.find((i) => i.id === 'res-projector-duri')!;
    expect(duriProjector.availability).toEqual({
      status: 'AVAILABLE',
      reason: null,
      billingDays: 2,
      totalFeeKrw: 4000,
    });
    const mine = await api(
      'hana',
      'GET',
      `/catalog?source=RESIDENT&category=TOOLS&startAt=${p.startAt}&endAt=${p.endAt}`,
    );
    const tools = listDataSchema(CatalogItemSchema).parse(mine.json().data).items;
    expect(tools.map((i) => [i.id, i.availability?.reason])).toEqual([
      ['res-tool-hana', 'OWN_ITEM'],
    ]);

    const detail = await api('hana', 'GET', '/catalog/pub-case');
    expect(detail.statusCode, detail.body).toBe(200);
    const parsed = CatalogItemDetailSchema.parse(detail.json().data);
    expect(parsed.occupied.map((o) => o.kind)).toEqual(['UNAVAILABLE']);
    expect(parsed.description).toBeNull();
    expect((await api('hana', 'GET', '/catalog/res-case-seul')).statusCode).toBe(404);
    expect((await api('hana', 'GET', `/catalog?startAt=${p.startAt}`)).statusCode).toBe(422);
    // 세션 없이 조회할 수 없다.
    expect((await app.inject({ method: 'GET', url: '/api/v1/catalog' })).statusCode).toBe(401);
  });
});

describe('3번 reservations and waitlist', () => {
  it('requests, approves, blocks overlap, waits in order with first-in-line priority', async () => {
    const p = period(30, 6);
    const hana = await reserved('hana', 'res-projector-duri', p, 'place-library');
    expect(hana.reservation).toMatchObject({
      status: 'PENDING',
      origin: 'CATALOG',
      ownerId: 'u_duri',
      totalFeeKrw: 2000,
      version: 1,
    });
    expect(hana.allowedActions).toEqual(['CANCEL']);
    expect(hana.history.map((h) => h.reason)).toEqual(['REQUESTED']);
    // 소유자 알림과 소유자 화면의 응답 버튼
    const duriInbox = await notifications('duri');
    expect(duriInbox.items[0]).toMatchObject({
      type: 'RESERVATION_REQUESTED',
      reservationId: hana.reservation.id,
      readAt: null,
    });
    expect((await get('duri', hana.reservation.id)).allowedActions).toEqual([
      'OWNER_APPROVE',
      'OWNER_DECLINE',
    ]);
    // 남의 예약은 404, 요청자는 응답할 수 없다.
    expect((await api('seul', 'GET', `/reservations/${hana.reservation.id}`)).statusCode).toBe(404);
    expect((await respond('hana', hana, 'APPROVE')).statusCode).toBe(404);
    // PENDING은 점유하지 않는다: 다른 사람도 신청할 수 있고, 같은 사람의 중복 신청은 막는다.
    const jun = await reserved('jun', 'res-projector-duri', p, 'place-center');
    const dup = await reserve('hana', 'res-projector-duri', period(32, 2), 'place-library');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_RESERVATION');

    // 승인: 기간 점유, 겹치는 다른 신청은 자동 정리
    const approved = await respond('duri', hana, 'APPROVE');
    expect(approved.statusCode, approved.body).toBe(200);
    expect(view(approved.body).reservation).toMatchObject({ status: 'CONFIRMED', version: 2 });
    expect((await get('jun', jun.reservation.id)).reservation).toMatchObject({
      status: 'DECLINED',
      closedReason: 'PERIOD_TAKEN',
    });
    expect((await notifications('hana')).items[0]).toMatchObject({ type: 'RESERVATION_CONFIRMED' });
    // 늦은 화면의 재응답은 버전 충돌
    expect((await respond('duri', hana, 'DECLINE')).statusCode).toBe(409);

    // 점유된 기간: 신청 409 RESERVED, 가용성 조회, 1번 검색 후보도 UNAVAILABLE
    const blocked = await reserve('seul', 'res-projector-duri', p, 'place-library');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({
      code: 'AVAILABILITY_CONFLICT',
      details: { reason: 'RESERVED', waitlistable: true },
    });
    const availability = ItemAvailabilitySchema.parse(
      (
        await api(
          'seul',
          'GET',
          `/catalog/res-projector-duri/availability?startAt=${p.startAt}&endAt=${p.endAt}`,
        )
      ).json().data,
    );
    expect(availability).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'RESERVED',
      waitlistable: true,
    });
    const need: NeedDraft = {
      category: 'HOBBY',
      queryText: '프로젝터',
      ...p,
      preferredPlaceIds: ['place-center', 'place-library'],
      maxBudgetKrw: null,
    };
    const created = RequestViewSchema.parse(
      (await api('jun', 'POST', '/requests', { need })).json().data,
    );
    await api('jun', 'POST', `/requests/${created.request.id}/search`, {
      expectedRequestVersion: 1,
    });
    await db.runSearch(created.request.id, { kind: 'NEED', needRevision: 1 });
    const searched = RequestViewSchema.parse(
      (await api('jun', 'GET', `/requests/${created.request.id}`)).json().data,
    );
    expect(searched.candidates.find((c) => c.itemId === 'res-projector-duri')).toMatchObject({
      availability: 'UNAVAILABLE',
      unavailableReason: 'RESERVED',
    });

    // 대기: 순번, 중복 대기 차단, 지금 신청 가능한 기간은 대기 불가
    const seulWait = await api('seul', 'POST', '/waitlist-entries', {
      itemId: 'res-projector-duri',
      ...p,
    });
    expect(seulWait.statusCode, seulWait.body).toBe(201);
    expect(WaitlistEntrySchema.parse(seulWait.json().data)).toMatchObject({
      status: 'WAITING',
      position: 1,
    });
    expect(
      (
        await api('seul', 'POST', '/waitlist-entries', {
          itemId: 'res-projector-duri',
          ...period(31, 2),
        })
      ).json().error.code,
    ).toBe('ALREADY_WAITLISTED');
    const junWait = await api('jun', 'POST', '/waitlist-entries', {
      itemId: 'res-projector-duri',
      ...p,
    });
    expect(WaitlistEntrySchema.parse(junWait.json().data).position).toBe(2);
    const free = await api('jun', 'POST', '/waitlist-entries', {
      itemId: 'res-projector-duri',
      ...period(80, 2),
    });
    expect(free.json().error.code).toBe('NOT_WAITLISTABLE');

    // 확정 취소 → 1순위만 우선권(30분), 2순위·다른 사람 신청은 WAITLIST_PRIORITY
    const current = await get('hana', hana.reservation.id);
    const cancelled = await api('hana', 'POST', `/reservations/${hana.reservation.id}/cancel`, {
      expectedVersion: current.reservation.version,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(view(cancelled.body).reservation.status).toBe('CANCELLED');
    const [seulEntry] = await waitlist('seul');
    expect(seulEntry).toMatchObject({ status: 'NOTIFIED', position: 1 });
    expect(Date.parse(seulEntry!.priorityUntil!) - now.getTime()).toBe(30 * 60_000);
    expect((await notifications('seul')).items[0]).toMatchObject({ type: 'WAITLIST_AVAILABLE' });
    expect((await notifications('duri')).items[0]).toMatchObject({ type: 'RESERVATION_CANCELLED' });
    expect((await waitlist('jun'))[0]).toMatchObject({ status: 'WAITING', position: 2 });
    const junBlocked = await reserve('jun', 'res-projector-duri', p, 'place-center');
    expect(junBlocked.json().error.details.reason).toBe('WAITLIST_PRIORITY');

    // 우선권이 지나면(정리 작업) 다음 순위로
    now = new Date(now.getTime() + 31 * 60_000);
    await sweepReservations(db, now);
    expect((await waitlist('seul'))[0]).toMatchObject({
      status: 'EXPIRED',
      closedReason: 'PRIORITY_EXPIRED',
    });
    expect((await notifications('seul')).items[0]).toMatchObject({ type: 'WAITLIST_EXPIRED' });
    expect((await waitlist('jun'))[0]).toMatchObject({ status: 'NOTIFIED', position: 1 });

    // 우선권 보유자의 신청은 결정될 때까지 우선권 유지(APPLIED), 거절되면 끝난다.
    const junApplied = await reserved('jun', 'res-projector-duri', p, 'place-center');
    expect(junApplied.reservation.waitlistEntryId).toBe((await waitlist('jun'))[0]!.id);
    expect((await waitlist('jun'))[0]!.status).toBe('APPLIED');
    const seulLate = await reserve('seul', 'res-projector-duri', p, 'place-library');
    expect(seulLate.json().error.details.reason).toBe('WAITLIST_PRIORITY');
    const declined = await respond('duri', junApplied, 'DECLINE');
    expect(declined.statusCode, declined.body).toBe(200);
    expect((await waitlist('jun'))[0]).toMatchObject({
      status: 'EXPIRED',
      closedReason: 'RESERVATION_DECLINED',
    });
    expect((await notifications('jun')).items[0]).toMatchObject({ type: 'RESERVATION_DECLINED' });
    // 이제 아무도 우선권이 없어 누구나 신청할 수 있다.
    expect((await reserve('seul', 'res-projector-duri', p, 'place-library')).statusCode).toBe(201);
  });

  it('confirms only one of two concurrent approvals for overlapping periods', async () => {
    const a = period(60, 4);
    const b = {
      startAt: new Date(Date.parse(a.startAt) + 2 * HOUR).toISOString(),
      endAt: new Date(Date.parse(a.endAt) + 2 * HOUR).toISOString(),
    };
    const first = await reserved('hana', 'res-cleaner-duri', a, 'place-center');
    const second = await reserved('seul', 'res-cleaner-duri', b, 'place-center');
    const results = await Promise.all([
      respond('duri', first, 'APPROVE'),
      respond('duri', second, 'APPROVE'),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const rows = await db.pool.query(
      "SELECT count(*)::int AS n FROM reservations WHERE item_id='res-cleaner-duri' AND status='CONFIRMED'",
    );
    expect(rows.rows[0].n).toBe(1);
    // DB 제약이 겹치는 확정을 최종적으로 거부한다.
    await expect(
      db.pool.query(
        "UPDATE reservations SET status='CONFIRMED' WHERE item_id='res-cleaner-duri' AND status<>'CONFIRMED'",
      ),
    ).rejects.toThrow(/exclusion|conflicting key/);
  });

  it('answers center items with the demo scenario and expires unanswered requests lazily', async () => {
    const p = period(70, 3);
    const projector = await reserved('hana', 'pub-projector', p, 'place-center');
    const ladder = await reserved('hana', 'pub-ladder', p, 'place-center');
    expect(projector.reservation.ownerId).toBeNull();
    expect((await respond('duri', projector, 'APPROVE')).statusCode).toBe(404);
    await sweepReservations(db, now);
    expect((await get('hana', projector.reservation.id)).reservation.status).toBe('CONFIRMED');
    expect((await get('hana', ladder.reservation.id)).reservation).toMatchObject({
      status: 'DECLINED',
      closedReason: 'PUBLIC_DEMO_DECLINED',
    });
    expect(
      (await get('hana', projector.reservation.id)).history.map((h) => [h.status, h.actor]),
    ).toEqual([
      ['PENDING', 'REQUESTER'],
      ['CONFIRMED', 'PUBLIC_DEMO'],
    ]);

    // 시작 3시간 전 신청 → 응답 기한은 시작 시각. 기한이 지나면 승인은 410, 예약은 만료.
    const soon = period(3, 2);
    const pending = await reserved('seul', 'res-projector-duri', soon, 'place-library');
    expect(pending.reservation.responseDueAt).toBe(soon.startAt);
    now = new Date(Date.parse(soon.startAt) + 60_000);
    const late = await respond('duri', pending, 'APPROVE');
    expect(late.statusCode).toBe(410);
    expect((await get('seul', pending.reservation.id)).reservation).toMatchObject({
      status: 'EXPIRED',
      closedReason: 'RESPONSE_EXPIRED',
    });
    expect((await notifications('seul')).items[0]).toMatchObject({ type: 'RESERVATION_EXPIRED' });
  });

  it('closes an approval that can no longer succeed and isolates a broken record in the sweep', async () => {
    // 2번에서 물품을 비활성화한 뒤의 승인: 신청을 닫고 신청자에게 알린다(리뷰 지적 반영).
    const p = period(90, 3);
    const pending = await reserved('seul', 'res-tool-hana', p, 'place-center');
    await db.pool.query(
      "UPDATE items SET data=jsonb_set(data,'{enabled}','false') WHERE id='res-tool-hana'",
    );
    const blocked = await respond('hana', pending, 'APPROVE');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details).toMatchObject({ reason: 'ITEM_DISABLED', closed: true });
    expect((await get('seul', pending.reservation.id)).reservation).toMatchObject({
      status: 'DECLINED',
      closedReason: 'ITEM_DISABLED',
    });
    expect((await notifications('seul')).items[0]).toMatchObject({
      type: 'RESERVATION_DECLINED',
      reservationId: pending.reservation.id,
    });
    await db.pool.query(
      "UPDATE items SET data=jsonb_set(data,'{enabled}','true') WHERE id='res-tool-hana'",
    );

    // 대기 취소의 버전 검사(점유된 기간을 먼저 만든다)
    const busy = period(120, 2);
    const owned = await reserved('jun', 'pub-projector', busy, 'place-center');
    await sweepReservations(db, now);
    expect((await get('jun', owned.reservation.id)).reservation.status).toBe('CONFIRMED');
    const wait = await api('seul', 'POST', '/waitlist-entries', {
      itemId: 'pub-projector',
      ...busy,
    });
    expect(wait.statusCode, wait.body).toBe(201);
    const entry = WaitlistEntrySchema.parse(wait.json().data);
    const stale = await api('seul', 'DELETE', `/waitlist-entries/${entry.id}`, {
      expectedVersion: entry.version + 1,
    });
    expect(stale.statusCode).toBe(409);
    const removed = await api('seul', 'DELETE', `/waitlist-entries/${entry.id}`, {
      expectedVersion: entry.version,
    });
    expect(WaitlistEntrySchema.parse(removed.json().data).status).toBe('CANCELLED');

    // 정리 작업: 한 건이 깨져도 나머지는 처리하고 마지막에 오류를 알린다.
    const a = await reserved('jun', 'pub-cleaner', period(110, 2), 'place-center');
    const b = await reserved('jun', 'pub-projector', period(112, 2), 'place-center');
    await db.pool.query(
      `UPDATE reservations SET data=jsonb_set(data,'{item}','{}'::jsonb) WHERE id=$1`,
      [a.reservation.id],
    );
    await expect(sweepReservations(db, now)).rejects.toThrow(/Invalid reservation/);
    const rows = await db.pool.query('SELECT id, status FROM reservations WHERE id=ANY($1)', [
      [a.reservation.id, b.reservation.id],
    ]);
    expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.status]))).toEqual({
      [a.reservation.id]: 'PENDING',
      [b.reservation.id]: 'CONFIRMED',
    });
    await db.pool.query("UPDATE reservations SET status='CANCELLED' WHERE id=$1", [
      a.reservation.id,
    ]);
  });

  it('marks notifications read and lists newest first', async () => {
    const before = await notifications('duri');
    expect(before.unreadCount).toBeGreaterThan(0);
    const times = before.items.map((n) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const one = await api('duri', 'POST', '/notifications/read', {
      notificationIds: [before.items[0]!.id],
    });
    expect(one.json().data.unreadCount).toBe(before.unreadCount - 1);
    // 남의 알림 ID는 무시한다.
    const foreign = (await notifications('hana')).items[0]!.id;
    await api('duri', 'POST', '/notifications/read', { notificationIds: [foreign] });
    expect((await notifications('hana')).items[0]!.readAt).toBeNull();
    const all = await api('duri', 'POST', '/notifications/read', { all: true });
    expect(all.json().data.unreadCount).toBe(0);
    expect((await api('duri', 'POST', '/notifications/read', { all: false })).statusCode).toBe(422);
  });
});

describe('3번 confirm from the payment preview', () => {
  it('turns the selected offer and its demo hold into one confirmed reservation', async () => {
    for (const who of ['hana', 'duri', 'seul', 'jun']) actors[who] = await enter(`demo-${who}`);
    const p = period(100, 5);
    const need: NeedDraft = {
      category: 'TRAVEL',
      queryText: '여행 가방',
      ...p,
      preferredPlaceIds: ['place-center', 'place-library'],
      maxBudgetKrw: null,
    };
    const created = RequestViewSchema.parse(
      (await api('jun', 'POST', '/requests', { need })).json().data,
    );
    await api('jun', 'POST', `/requests/${created.request.id}/search`, {
      expectedRequestVersion: 1,
    });
    await db.runSearch(created.request.id, { kind: 'NEED', needRevision: 1 });
    const matched = RequestViewSchema.parse(
      (await api('jun', 'GET', `/requests/${created.request.id}`)).json().data,
    );
    const candidate = matched.candidates.find((c) => c.itemId === 'res-case-hana')!;
    expect(candidate.availability).toBe('AVAILABLE');
    const submitted = RequestViewSchema.parse(
      (
        await api('jun', 'POST', `/requests/${created.request.id}/submit`, {
          expectedRequestVersion: matched.request.version,
          selections: [
            {
              candidateId: candidate.id,
              quoteId: candidate.quoteId,
              totalFeeKrw: candidate.suggestedTerms.totalFeeKrw,
            },
          ],
        })
      ).json().data,
    );
    const negotiation = submitted.negotiations[0]!;
    expect((await notifications('hana')).items[0]).toMatchObject({
      type: 'NEGOTIATION_REQUESTED',
      negotiationId: negotiation.id,
    });
    const owner = await api('hana', 'POST', `/negotiations/${negotiation.id}/owner-response`, {
      action: 'APPROVE',
      expectedNegotiationVersion: negotiation.version,
      expectedTermsRevision: negotiation.termsRevision,
      terms: null,
    });
    expect(owner.statusCode, owner.body).toBe(200);
    expect((await notifications('jun')).items[0]).toMatchObject({ type: 'OFFER_RECEIVED' });
    const offered = RequestViewSchema.parse(
      (await api('jun', 'GET', `/requests/${created.request.id}`)).json().data,
    );
    const n = offered.negotiations[0]!;
    const selected = await api('jun', 'POST', `/requests/${created.request.id}/select`, {
      expectedRequestVersion: offered.request.version,
      negotiationId: n.id,
      expectedNegotiationVersion: n.version,
      offerId: n.offer!.id,
      termsRevision: n.termsRevision,
      acknowledgeCloseOtherBranches: true,
    });
    expect(selected.statusCode, selected.body).toBe(200);
    // 데모 점유 동안 다른 사람의 바로 신청은 ACTIVE_HOLD
    const held = await reserve('seul', 'res-case-hana', p, 'place-center');
    expect(held.json().error.details).toEqual({ reason: 'ACTIVE_HOLD', waitlistable: true });

    const body = {
      itemId: n.itemId,
      startAt: n.terms.startAt,
      endAt: n.terms.endAt,
      placeId: n.terms.placeId,
      requestId: created.request.id,
      negotiationId: n.id,
    };
    expect(
      (await api('jun', 'POST', '/reservations', { ...body, placeId: 'place-station' })).statusCode,
    ).toBe(422);
    expect((await api('seul', 'POST', '/reservations', body)).statusCode).toBe(404);
    const confirmed = await api('jun', 'POST', '/reservations', body);
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const reservation = view(confirmed.body).reservation;
    expect(reservation).toMatchObject({
      status: 'CONFIRMED',
      origin: 'REQUEST',
      requestId: created.request.id,
      negotiationId: n.id,
      totalFeeKrw: n.terms.totalFeeKrw,
      ownerId: 'u_hana',
    });
    const hold = await db.pool.query('SELECT status FROM demo_holds WHERE request_id=$1', [
      created.request.id,
    ]);
    expect(hold.rows[0].status).toBe('RELEASED');
    expect((await notifications('hana')).items[0]).toMatchObject({ type: 'RESERVATION_CONFIRMED' });
    // 재확정은 같은 예약(요청당 1건), 요청별 조회
    const again = await api('jun', 'POST', '/reservations', body);
    expect(view(again.body).reservation.id).toBe(reservation.id);
    const byRequest = await api('jun', 'GET', `/reservations?requestId=${created.request.id}`);
    expect(byRequest.json().data.items.map((v: ReservationView) => v.reservation.id)).toEqual([
      reservation.id,
    ]);
    // 소유자 목록에도 보이고, 점유는 RESERVED로 바뀐다.
    const ownerList = await api('hana', 'GET', '/reservations?role=OWNER');
    expect(ownerList.json().data.items.map((v: ReservationView) => v.reservation.id)).toContain(
      reservation.id,
    );
    const after = await reserve('seul', 'res-case-hana', p, 'place-center');
    expect(after.json().error.details.reason).toBe('RESERVED');
  });

  it('rejects confirmation after the 10-minute demo hold expired', async () => {
    const p = period(130, 5);
    const need: NeedDraft = {
      category: 'HOBBY',
      queryText: '프로젝터',
      ...p,
      preferredPlaceIds: ['place-station'],
      maxBudgetKrw: null,
    };
    const created = RequestViewSchema.parse(
      (await api('hana', 'POST', '/requests', { need })).json().data,
    );
    await api('hana', 'POST', `/requests/${created.request.id}/search`, {
      expectedRequestVersion: 1,
    });
    await db.runSearch(created.request.id, { kind: 'NEED', needRevision: 1 });
    const matched = RequestViewSchema.parse(
      (await api('hana', 'GET', `/requests/${created.request.id}`)).json().data,
    );
    const candidate = matched.candidates.find((c) => c.itemId === 'res-projector-seul')!;
    const submitted = RequestViewSchema.parse(
      (
        await api('hana', 'POST', `/requests/${created.request.id}/submit`, {
          expectedRequestVersion: matched.request.version,
          selections: [
            {
              candidateId: candidate.id,
              quoteId: candidate.quoteId,
              totalFeeKrw: candidate.suggestedTerms.totalFeeKrw,
            },
          ],
        })
      ).json().data,
    );
    const negotiation = submitted.negotiations[0]!;
    await api('seul', 'POST', `/negotiations/${negotiation.id}/owner-response`, {
      action: 'APPROVE',
      expectedNegotiationVersion: negotiation.version,
      expectedTermsRevision: negotiation.termsRevision,
      terms: null,
    });
    const offered = RequestViewSchema.parse(
      (await api('hana', 'GET', `/requests/${created.request.id}`)).json().data,
    );
    const n = offered.negotiations[0]!;
    expect(
      (
        await api('hana', 'POST', `/requests/${created.request.id}/select`, {
          expectedRequestVersion: offered.request.version,
          negotiationId: n.id,
          expectedNegotiationVersion: n.version,
          offerId: n.offer!.id,
          termsRevision: n.termsRevision,
          acknowledgeCloseOtherBranches: true,
        })
      ).statusCode,
    ).toBe(200);
    now = new Date(now.getTime() + 11 * 60_000);
    const late = await api('hana', 'POST', '/reservations', {
      itemId: n.itemId,
      startAt: n.terms.startAt,
      endAt: n.terms.endAt,
      placeId: n.terms.placeId,
      requestId: created.request.id,
      negotiationId: n.id,
    });
    expect(late.statusCode, late.body).toBe(410);
    expect(late.json().error.code).toBe('OFFER_EXPIRED');
    const hold = await db.pool.query('SELECT status FROM demo_holds WHERE request_id=$1', [
      created.request.id,
    ]);
    expect(hold.rows[0].status).toBe('EXPIRED');
  });
});
