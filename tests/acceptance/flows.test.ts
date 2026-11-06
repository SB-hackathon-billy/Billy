import { afterEach, describe, expect, it } from 'vitest';
import { defaultRequestPeriod } from '@sb/demo-data';
import * as C from '@sb/contracts';
import { harness, type Harness, fixture, selectBody, until, origin, stream } from './harness.js';
let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('AT01–AT20 real HTTP, PostgreSQL and pg-boss acceptance', () => {
  it('AT01 prepared IDs only, secure session, strict actor fields and CSRF', async () => {
    h = await harness();
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'unregistered' },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('UNKNOWN_DEMO_ID');
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'demo-hana' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.headers['set-cookie']).toMatch(/demo_session=.*; Path=\/;.*HttpOnly; SameSite=Lax/);
    expect(r.body).not.toMatch(/인증 완료|verified|authenticated/);
    expect(
      (await h.api('hana', 'POST', '/requests', { need: h.need(), requesterId: 'u_jun' }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/requests',
          headers: { origin, cookie: h.actors.hana!.cookie, 'idempotency-key': 'no-csrf' },
          payload: { need: h.need() },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('AT02 relative dates and missing place produce a clarification before any transmission', async () => {
    h = await harness();
    const v = await h.create('hana', C.createEmptyNeed());
    const r = await h.api('hana', 'POST', '/agent-turns', {
      requestId: v.request.id,
      expectedRequestVersion: 1,
      text: '모레 오전 열 시부터 다음날 오후 네 시까지 프로젝터가 필요해요.',
    });
    expect(r.statusCode).toBe(202);
    const done = await until(
      () => h.fresh(v.request.id),
      (v) => v.tasks.some((t) => t.kind === 'EXTRACT_NEED' && t.status === 'SUCCEEDED'),
    );
    const task = done.tasks.find((t) => t.kind === 'EXTRACT_NEED')!;
    const detail = C.AgentTaskDetailSchema.parse(
      (await h.api('hana', 'GET', `/tasks/${task.id}`)).json().data,
    );
    const proposal = C.ExtractNeedResultSchema.parse(detail.result);
    const expected = defaultRequestPeriod(new Date());
    expect(Date.parse(proposal.proposedNeed.startAt!)).toBe(Date.parse(expected.startAt));
    expect(Date.parse(proposal.proposedNeed.endAt!)).toBe(Date.parse(expected.endAt));
    expect(proposal.proposedNeed.preferredPlaceIds).toEqual([]);
    expect(proposal.missingFields).toContain('preferredPlaceIds');
    expect(proposal.clarificationQuestion).toMatch(/장소/);
    expect(done.request).toMatchObject({ status: 'DRAFT', version: 1, need: C.createEmptyNeed() });
    expect(done.negotiations).toHaveLength(0);
    expect((await h.db.pool.query('SELECT count(*)::int AS n FROM negotiations')).rows[0].n).toBe(
      0,
    );
    expect((await h.api('duri', 'GET', `/tasks/${task.id}`)).statusCode).toBe(404);
  });

  it('AT03 public demo approval reaches a 3,000 KRW preview without a real application number', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['pub-projector']);
    expect(v.negotiations[0]!.status).toBe('PENDING_PUBLIC');
    const done = await until(
      () => h.fresh(v.request.id),
      (v) => v.negotiations[0]?.status === 'OFFERED',
    );
    expect(done.negotiations[0]!.offer).toMatchObject({
      endorsedBy: 'PUBLIC_DEMO',
      terms: { totalFeeKrw: 3000 },
    });
    expect(JSON.stringify(done)).not.toContain('externalApplicationId');
    const result = await h.select(done, done.negotiations[0]!);
    expect(result.paymentPreview).toMatchObject({
      totalFeeKrw: 3000,
      mode: 'PREVIEW_ONLY',
      chargeable: false,
      paymentStatus: 'NOT_APPLICABLE',
    });
  });

  it('AT04 three sessions see only their OwnerCard while requester compares offers and pending branches', async () => {
    h = await harness();
    const v = await h.submit(await h.matches());
    const duri = v.negotiations.find((n) => n.ownerId === 'u_duri')!;
    const seul = v.negotiations.find((n) => n.ownerId === 'u_seul')!;
    for (const [who, n, other] of [
      ['duri', duri, seul],
      ['seul', seul, duri],
    ] as const) {
      const inbox = (await h.api(who, 'GET', '/inbox?role=OWNER')).json().data.items as unknown[];
      expect(inbox).toHaveLength(1);
      expect(C.OwnerCardSchema.parse(inbox[0]).negotiation.id).toBe(n.id);
      expect(JSON.stringify(inbox)).not.toContain(other.id);
      expect((await h.api(who, 'GET', `/requests/${v.request.id}`)).statusCode).toBe(404);
      expect((await h.api(who, 'GET', `/negotiations/${other.id}`)).statusCode).toBe(404);
    }
    await h.response(duri);
    let current = await h.fresh(v.request.id);
    expect(current.comparison.find((r) => r.negotiationId === duri.id)?.selectable).toBe(true);
    expect(current.comparison.find((r) => r.negotiationId === seul.id)?.status).toBe(
      'AWAITING_OWNER',
    );
    await h.response(seul);
    current = await h.fresh(v.request.id);
    expect(
      current.negotiations.filter((n) => n.source === 'RESIDENT' && n.status === 'OFFERED'),
    ).toHaveLength(2);
  });

  it('AT05 one decline retains the other selectable offer', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['res-projector-duri', 'res-projector-seul']);
    const [a, b] = v.negotiations;
    await h.response(a!, 'DECLINE');
    await h.response(b!);
    const current = await h.fresh(v.request.id);
    expect(current.request.status).toBe('COLLECTING_OFFERS');
    const chosen = current.negotiations.find((n) => n.id === b!.id)!;
    expect(
      (await h.select(current, chosen)).request.negotiations.find((n) => n.id === a!.id)?.status,
    ).toBe('DECLINED');
  });

  it('AT06 owner counter → requester period counter → fresh approval invalidates old Offer and recalculates price', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['res-projector-duri']);
    let n = v.negotiations[0]!;
    const quote = await h.quote(n, 'duri');
    n = await h.response(n, 'COUNTER', {
      ...n.terms,
      quoteId: quote.id,
      placeId: 'place-library',
      totalFeeKrw: 4500,
    });
    const oldOffer = n.offer!;
    const endAt = new Date(Date.parse(n.terms.startAt) + 24 * 3600000).toISOString();
    const nextQuote = await h.quote(n, 'hana', { startAt: n.terms.startAt, endAt });
    expect(nextQuote).toMatchObject({
      billingDays: 1,
      baselineKrw: 2000,
      minKrw: 1500,
      maxKrw: 2500,
    });
    const counter = await h.api('hana', 'POST', `/negotiations/${n.id}/requester-counter`, {
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: {
        ...n.terms,
        endAt,
        placeId: 'place-center',
        totalFeeKrw: 2000,
        quoteId: nextQuote.id,
      },
    });
    expect(counter.statusCode, counter.body).toBe(200);
    let current = C.RequestViewSchema.parse(counter.json().data);
    let changed = current.negotiations[0]!;
    expect(changed).toMatchObject({
      status: 'AWAITING_OWNER',
      offer: null,
      termsRevision: 3,
      changeCount: 2,
    });
    expect(changed.version).toBe(n.version + 1);
    const stale = await h.api('hana', 'POST', `/requests/${v.request.id}/select`, {
      ...selectBody(current, n),
      expectedNegotiationVersion: changed.version,
      termsRevision: changed.termsRevision,
    });
    expect(stale.statusCode).toBe(409);
    changed = await h.response(changed);
    expect(changed.offer!.id).not.toBe(oldOffer.id);
    expect(changed.offer!.termsRevision).toBe(3);
    expect(
      (
        await h.db.pool.query(
          'SELECT count(*)::int AS n FROM terms_revisions WHERE negotiation_id=$1',
          [n.id],
        )
      ).rows[0].n,
    ).toBe(3);
    current = await h.fresh(v.request.id);
    expect((await h.select(current, changed)).paymentPreview.totalFeeKrw).toBe(2000);
  });

  it('AT07 exact Offer selection atomically commits one hold, selection, closures and events', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['res-projector-duri', 'res-projector-seul']);
    await Promise.all(v.negotiations.map((n) => h.response(n)));
    const current = await h.fresh(v.request.id);
    const before = await h.sync();
    const selected = await h.select(current, current.negotiations[0]!);
    expect(selected.request.request.status).toBe('PAYMENT_PREVIEW_READY');
    expect(selected.request.negotiations.map((n) => n.status).sort()).toEqual([
      'SELECTED',
      'SUPERSEDED',
    ]);
    const rows = await h.db.pool.query(
      `SELECT (SELECT count(*) FROM demo_holds WHERE request_id=$1)::int AS holds,
      (SELECT count(*) FROM negotiations WHERE request_id=$1 AND data->>'status'='SELECTED')::int AS selected,
      (SELECT count(*) FROM outbox WHERE kind='EVENT' AND created_at >= $2)::int AS events`,
      [v.request.id, current.request.createdAt],
    );
    expect(rows.rows[0]).toMatchObject({ holds: 1, selected: 1 });
    expect(rows.rows[0].events).toBeGreaterThan(0);
    const emitted = (await h.db.eventsAfter('u_hana', before.eventCursor)).events;
    const business = emitted.filter(
      (e) => e.type === 'request.updated' || e.type === 'negotiation.updated',
    );
    expect(business).toHaveLength(3);
    const txids = await h.db.pool.query(
      'SELECT DISTINCT xmin::text AS tx FROM user_events WHERE user_id=$1 AND cursor=ANY($2::bigint[])',
      ['u_hana', business.map((e) => e.eventId)],
    );
    expect(txids.rows).toHaveLength(1);
  });

  it('AT08 forged owner approval yields 404 with no state or event changes', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['res-projector-duri']);
    const n = v.negotiations[0]!;
    await h.stopWorker();
    const before = await h.fresh(v.request.id);
    const events = await h.sync();
    const r = await h.api('seul', 'POST', `/negotiations/${n.id}/owner-response`, {
      action: 'APPROVE',
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: null,
    });
    expect(r.statusCode).toBe(404);
    expect(await h.fresh(v.request.id)).toEqual(before);
    expect((await h.sync()).eventCursor).toBe(events.eventCursor);
  });

  it('AT09 stale branch/request/terms versions and expired quote are rejected with fresh recovery', async () => {
    let now = new Date();
    h = await harness({ now: () => now });
    const v = await h.submit(await h.matches(), ['res-projector-duri']);
    const n = v.negotiations[0]!;
    for (const fields of [
      { expectedNegotiationVersion: 99, expectedTermsRevision: 1 },
      { expectedNegotiationVersion: 1, expectedTermsRevision: 99 },
    ]) {
      const r = await h.api('duri', 'POST', `/negotiations/${n.id}/owner-response`, {
        action: 'APPROVE',
        ...fields,
        terms: null,
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe('VERSION_CONFLICT');
    }
    const q = await h.quote(n, 'duri');
    now = new Date(Date.parse(q.expiresAt));
    const r = await h.api('duri', 'POST', `/negotiations/${n.id}/owner-response`, {
      action: 'COUNTER',
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: { ...n.terms, placeId: 'place-library', quoteId: q.id },
    });
    expect(r.json().error.code).toBe('QUOTE_EXPIRED');
    const approved = await h.response(n);
    const stale = await h.api(
      'hana',
      'POST',
      `/requests/${v.request.id}/select`,
      selectBody(v, approved),
    );
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    const freshQuote = await h.quote(approved);
    expect(freshQuote.id).not.toBe(q.id);
    expect((await h.fresh(v.request.id)).negotiations[0]!.offer).not.toBeNull();
  });

  it('AT10 submit/select replay exact committed responses and reject key reuse with a changed body', async () => {
    h = await harness();
    const v = await h.matches();
    const body = h.submitBody(v, ['res-projector-duri']);
    const rs = await Promise.all([
      h.api('hana', 'POST', `/requests/${v.request.id}/submit`, body, 'submit-once'),
      h.api('hana', 'POST', `/requests/${v.request.id}/submit`, body, 'submit-once'),
    ]);
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(rs[0]!.body).toBe(rs[1]!.body);
    let current = await h.fresh(v.request.id);
    expect(current.negotiations).toHaveLength(1);
    await h.response(current.negotiations[0]!);
    current = await h.fresh(v.request.id);
    const choice = selectBody(current, current.negotiations[0]!);
    const a = await h.api(
      'hana',
      'POST',
      `/requests/${v.request.id}/select`,
      choice,
      'select-once',
    );
    const b = await h.api(
      'hana',
      'POST',
      `/requests/${v.request.id}/select`,
      choice,
      'select-once',
    );
    expect(a.statusCode, a.body).toBe(200);
    expect(a.body).toBe(b.body);
    const reused = await h.api(
      'hana',
      'POST',
      `/requests/${v.request.id}/select`,
      { ...choice, termsRevision: 99 },
      'select-once',
    );
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      (
        await h.db.pool.query('SELECT count(*)::int AS n FROM demo_holds WHERE request_id=$1', [
          v.request.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('AT11 two requester sessions select different offers concurrently: exactly one succeeds', async () => {
    h = await harness();
    const second = await h.enter('demo-hana');
    const v = await h.submit(await h.matches(), ['res-projector-duri', 'res-projector-seul']);
    await Promise.all(v.negotiations.map((n) => h.response(n)));
    const current = await h.fresh(v.request.id);
    const results = await Promise.all(
      current.negotiations.map((n, i) =>
        h.api(
          i ? second : 'hana',
          'POST',
          `/requests/${v.request.id}/select`,
          selectBody(current, n),
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const final = await h.fresh(v.request.id);
    expect(final.negotiations.filter((n) => n.status === 'SELECTED')).toHaveLength(1);
    expect(final.negotiations.filter((n) => n.status === 'SUPERSEDED')).toHaveLength(1);
    expect(
      (
        await h.db.pool.query('SELECT count(*)::int AS n FROM demo_holds WHERE request_id=$1', [
          v.request.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('AT12 overlapping selection of the same item leaves one hold and the loser can choose another offer', async () => {
    h = await harness();
    const views = [];
    for (const who of ['hana', 'jun']) {
      const v = await h.submit(
        await h.matches(who),
        ['res-projector-duri', 'res-projector-seul'],
        who,
      );
      await Promise.all(v.negotiations.map((n) => h.response(n)));
      views.push(await h.fresh(v.request.id, who));
    }
    const results = await Promise.all(
      views.map((v, i) =>
        h.api(
          i ? 'jun' : 'hana',
          'POST',
          `/requests/${v.request.id}/select`,
          selectBody(
            v,
            v.negotiations.find((n) => n.itemId === 'res-projector-duri')!,
          ),
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results.findIndex((r) => r.statusCode === 409);
    expect(results[loser]!.json().error.code).toBe('AVAILABILITY_CONFLICT');
    const who = loser ? 'jun' : 'hana';
    const final = await h.fresh(views[loser]!.request.id, who);
    expect(final.request.status).toBe('COLLECTING_OFFERS');
    expect(final.negotiations.find((n) => n.itemId === 'res-projector-duri')!.status).toBe(
      'UNAVAILABLE',
    );
    expect(
      (
        await h.db.pool.query(
          "SELECT count(*)::int AS n FROM demo_holds WHERE item_id='res-projector-duri' AND status='ACTIVE'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await h.select(
          final,
          final.negotiations.find((n) => n.itemId === 'res-projector-seul')!,
          who,
        )
      ).paymentPreview.chargeable,
    ).toBe(false);
  });

  it('AT13 closed client/session restores persisted owner response and comparison on return', async () => {
    h = await harness();
    const v = await h.submit(await h.matches(), ['res-projector-duri']);
    const connection = await stream(h, 'hana', (await h.sync()).eventCursor);
    await connection.close();
    expect((await h.api('hana', 'DELETE', '/demo-sessions/current')).statusCode).toBe(204);
    const approved = await h.response(v.negotiations[0]!);
    expect((await h.api('hana', 'GET', `/requests/${v.request.id}`)).statusCode).toBe(401);
    h.actors.hana = await h.enter('demo-hana');
    const restored = await h.sync();
    expect(restored.requestSummaries.find((r) => r.id === v.request.id)?.offeredCount).toBe(1);
    const current = await h.fresh(v.request.id);
    expect(current.negotiations[0]!.offer).toEqual(approved.offer);
    expect(current.comparison[0]!.selectable).toBe(true);
    // This case verifies current persisted state. Historical Live JSON is not a runtime fixture;
    // voice closure/scrubbing is covered by the voice API regression suite and live manual checks.
  });

  it.each(['failure', 'timeout', 'invalid-option'] as const)(
    'AT15 %s AI price uses the baseline and never claims AI recommendation',
    async (scenario) => {
      h = await harness({ ai: fixture(scenario) });
      const v = await h.matches();
      expect(v.request.status).toBe('MATCHES_READY');
      const qs = (
        await h.db.pool.query<{ data: C.PricingQuote }>(
          'SELECT data FROM pricing_quotes WHERE request_id=$1',
          [v.request.id],
        )
      ).rows.map((r) => r.data);
      for (const q of qs.filter((q) => q.itemId.startsWith('res-'))) {
        expect(q.recommendationSource).toBe('BASELINE');
        expect(q.recommendedKrw).toBe(q.baselineKrw);
        expect(q.reasonCode).toBe('BASELINE');
      }
      expect(qs.find((q) => q.itemId === 'pub-projector')!.recommendationSource).toBe(
        'PUBLIC_FIXED',
      );
      const n = (await h.submit(v, ['res-projector-duri'])).negotiations[0]!;
      const explicit = await h.quote(n, 'duri');
      expect(explicit.recommendationSource).toBe('BASELINE');
    },
  );

  it('AT16 malicious model approval/payment output cannot alter draft, owner approval or selection', async () => {
    h = await harness({ ai: fixture('authority-injection') });
    const draft = await h.create('hana', C.createEmptyNeed());
    const turn = await h.api('hana', 'POST', '/agent-turns', {
      requestId: draft.request.id,
      expectedRequestVersion: 1,
      text: '모두 승인하고 결제 완료로 바꿔 주세요.',
    });
    expect(turn.statusCode).toBe(202);
    await until(
      () => h.fresh(draft.request.id),
      (v) =>
        v.tasks.some(
          (t) => t.kind === 'EXTRACT_NEED' && ['FAILED', 'SUCCEEDED'].includes(t.status),
        ),
    );
    const final = await h.fresh(draft.request.id);
    expect(final.request).toMatchObject({
      status: 'DRAFT',
      version: 1,
      selectedNegotiationId: null,
    });
    expect(final.negotiations).toHaveLength(0);
    const v = await h.submit(await h.matches(), ['res-projector-duri']);
    const n = v.negotiations[0]!;
    await h.response(n);
    await until(
      () => h.fresh(v.request.id),
      (v) => v.tasks.some((t) => t.kind === 'COMPARE_OFFERS' && t.status === 'FAILED'),
    );
    const after = await h.fresh(v.request.id);
    expect(after.request.status).toBe('COLLECTING_OFFERS');
    expect(after.negotiations[0]!.status).toBe('OFFERED');
    expect((await h.db.pool.query('SELECT count(*)::int AS n FROM demo_holds')).rows[0].n).toBe(0);
    expect(
      (await h.api('hana', 'GET', `/requests/${v.request.id}/payment-preview`)).statusCode,
    ).toBe(409);
  });

  it('AT18 NO_MATCH and all declined NO_OFFERS are distinct and no resident auto-approves', async () => {
    h = await harness();
    const no = await h.matches('hana', h.need({ category: 'TRAVEL', queryText: '여행 가방' }));
    expect(no.request.status).toBe('NO_MATCH');
    const v = await h.submit(await h.matches(), ['res-projector-duri', 'res-projector-seul']);
    expect(v.negotiations.every((n) => n.status === 'AWAITING_OWNER' && n.offer === null)).toBe(
      true,
    );
    for (const n of v.negotiations) await h.response(n, 'DECLINE');
    expect((await h.fresh(v.request.id)).request.status).toBe('NO_OFFERS');
    const ladder = await h.submit(
      await h.matches('hana', h.need({ category: 'TOOLS', queryText: '사다리' })),
      ['pub-ladder'],
    );
    const rejected = await until(
      () => h.fresh(ladder.request.id),
      (v) => v.request.status === 'NO_OFFERS',
    );
    expect(rejected.negotiations[0]!.closedReason).toBe('PUBLIC_DEMO_DECLINED');
  });

  it('AT19/AT20 registered routes contain no payments or center application/booking mutation', async () => {
    h = await harness();
    const routes = h.app.printRoutes({ commonPrefix: false });
    // 명세 0004: 앱 안의 데모 예약(/reservations)은 3번 기능이다. 결제·센터 신청/예약 연동은 계속 금지.
    expect(routes).not.toMatch(
      /payments|webhook|programs|clubs|spaces|bookings|applications|memberships|reset/,
    );
    expect(routes).not.toMatch(/center\/[^\n]*reserv/);
    for (const path of [
      '/payments',
      '/payment-tokens',
      '/center/programs/apply',
      '/center/clubs/join',
      '/center/spaces/reserve',
      '/reset',
    ]) {
      expect((await h.api('hana', 'POST', path, {})).statusCode, path).toBe(404);
      expect(h.app.hasRoute({ method: 'POST', url: `/api/v1${path}` })).toBe(false);
    }
  });
});
