import { beforeAll, afterAll, it, expect, describe } from 'vitest';
import { buildSeed, defaultRequestPeriod } from '@sb/demo-data';
import {
  createEmptyNeed,
  computeFeeOptions,
  RequestViewSchema,
  PricingQuoteSchema,
  type NeedDraft,
  type RequestView,
  type Negotiation,
  type FeeRecommender,
  type RecommendFeeResult,
} from '@sb/contracts';
import { createTestDatabase } from './testing.js';
import { Database } from './database.js';
import { seed } from './seed.js';
let db: Database, cleanup: () => Promise<void>;
let now = new Date('2026-11-01T01:00:00Z');
const need = (overrides: Partial<NeedDraft> = {}): NeedDraft => ({
  category: 'HOBBY',
  queryText: '프로젝터',
  ...defaultRequestPeriod(now),
  preferredPlaceIds: ['place-center', 'place-station', 'place-library'],
  maxBudgetKrw: null,
  ...overrides,
});
async function search(actor = 'u_hana', draft = need(), recommender?: FeeRecommender) {
  const v = await db.transaction((u) => u.create(actor, draft));
  await db.transaction((u) => u.confirmAndSearch(actor, v.request.id, 1));
  await db.runSearch(
    v.request.id,
    { kind: 'NEED', needRevision: 1 },
    recommender ? { feeRecommender: recommender } : {},
  );
  return db.transaction((u) => u.getRequest(actor, v.request.id));
}
async function submit(actor = 'u_hana', ids = ['res-projector-duri'], draft = need()) {
  const view = await search(actor, draft);
  return db.transaction((u) =>
    u.submit(actor, view.request.id, {
      expectedRequestVersion: view.request.version,
      selections: ids.map((id) => {
        const c = view.candidates.find((c) => c.itemId === id)!;
        return { candidateId: c.id, quoteId: c.quoteId, totalFeeKrw: c.suggestedTerms.totalFeeKrw };
      }),
    }),
  );
}
const fresh = (v: RequestView) =>
  db.transaction((u) => u.getRequest(v.request.requesterId, v.request.id));
async function owner(n: Negotiation) {
  return db.transaction((u) =>
    u.ownerResponse(n.ownerId!, n.id, {
      action: 'APPROVE',
      expectedNegotiationVersion: n.version,
      expectedTermsRevision: n.termsRevision,
      terms: null,
    }),
  );
}
beforeAll(async () => {
  const test = await createTestDatabase({ now: () => now });
  db = test.db;
  cleanup = test.cleanup;
});
afterAll(async () => {
  await cleanup();
});
describe('domain transitions and persistent invariants', () => {
  it('returns NO_MATCH for a screwdriver instead of a ladder from the same category', async () => {
    const view = await search('u_jun', need({ category: 'TOOLS', queryText: '드라이버' }));
    expect(view.request.status).toBe('NO_MATCH');
    expect(view.candidates).toEqual([]);
  });
  it('empty draft requires explicit summary confirmation before search', async () => {
    const v = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    expect(v.request.status).toBe('DRAFT');
    await expect(
      db.transaction((u) => u.confirmAndSearch('u_hana', v.request.id, 1)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await fresh(v)).request.version).toBe(1);
  });
  it('editing MATCHES_READY clears candidate references and increments need revision only on content changes', async () => {
    const v = await search();
    const edited = await db.transaction((u) =>
      u.patchDraft('u_hana', v.request.id, {
        expectedRequestVersion: v.request.version,
        need: need({ queryText: '다른 물품' }),
      }),
    );
    expect(edited.request.status).toBe('DRAFT');
    expect(edited.request.needRevision).toBe(2);
    expect(edited.candidates).toEqual([]);
    const same = await db.transaction((u) =>
      u.patchDraft('u_hana', v.request.id, {
        expectedRequestVersion: edited.request.version,
        need: edited.request.need,
      }),
    );
    expect(same.request.version).toBe(edited.request.version);
    expect(await db.runSearch(v.request.id, { kind: 'NEED', needRevision: 1 })).toBe(false);
  });
  it('search excludes self-owned items and labels unavailable fixtures and missing intersection', async () => {
    const travel = await search('u_hana', need({ category: 'TRAVEL', queryText: '여행 가방' }));
    expect(travel.candidates.some((c) => c.itemId === 'res-case-hana')).toBe(false);
    expect(travel.request.status).toBe('NO_MATCH');
    expect(travel.candidates.map((c) => c.unavailableReason).sort()).toEqual([
      'ITEM_DISABLED',
      'PERIOD_UNAVAILABLE',
    ]);
    const place = await search('u_hana', need({ preferredPlaceIds: ['place-station'] }));
    expect(place.candidates.find((c) => c.itemId === 'pub-projector')!.unavailableReason).toBe(
      'PLACE_UNAVAILABLE',
    );
  });
  it('price quotes are scoped by request and branch, immutable, reusable only while fresh', async () => {
    const a = await search();
    const b = await search();
    const item = 'res-projector-duri';
    const payload = {
      requestId: a.request.id,
      negotiationId: null,
      itemId: item,
      ...defaultRequestPeriod(now),
    };
    const q1 = await db.transaction((u) => u.issueQuote('u_hana', payload));
    const q2 = await db.transaction((u) => u.issueQuote('u_hana', payload));
    expect(q1.id).toBe(q2.id);
    const q3 = await db.transaction((u) =>
      u.issueQuote('u_hana', { ...payload, requestId: b.request.id }),
    );
    expect(q3.id).not.toBe(q1.id);
    expect(q3.conditionsHash).toBe(q1.conditionsHash);
    await expect(
      db.pool.query('UPDATE pricing_quotes SET data=data||\'{"recommendedKrw":500}\' WHERE id=$1', [
        q1.id,
      ]),
    ).rejects.toThrow('immutable record');
  });
  it('fee integer boundaries match policy and source; malformed AI values fall back', async () => {
    const p = defaultRequestPeriod(now);
    expect(computeFeeOptions(2000, p.startAt, p.endAt)).toMatchObject({
      baselineKrw: 4000,
      minKrw: 3000,
      maxKrw: 5000,
    });
    expect(computeFeeOptions(1500, p.startAt, p.endAt, 'PUBLIC')).toMatchObject({
      baselineKrw: 3000,
      minKrw: 3000,
      maxKrw: 3000,
    });
    await db.pool.query('DELETE FROM fee_cache');
    const v = await search('u_hana', need(), {
      recommend: async () =>
        ({
          feeOptionId: 'INVENTED',
          reasonCode: 'BASELINE',
          reasonText: 'wrong',
        }) as unknown as RecommendFeeResult,
    });
    for (const c of v.candidates) {
      const q = PricingQuoteSchema.parse(
        (await db.pool.query('SELECT data FROM pricing_quotes WHERE id=$1', [c.quoteId])).rows[0]
          .data,
      );
      expect(q.recommendationSource).toBe(
        c.itemSummary.source === 'PUBLIC' ? 'PUBLIC_FIXED' : 'BASELINE',
      );
    }
  });
  it('valid AI options use computed amounts and disallowed evidence falls back', async () => {
    await db.pool.query('DELETE FROM fee_cache');
    const v = await search('u_hana', need(), {
      recommend: async () => ({
        feeOptionId: 'UPPER',
        reasonCode: 'REGISTERED_EXTRA_EFFORT',
        reasonText: '등록된 운반 부담',
      }),
    });
    const quotes = await db.pool.query('SELECT data FROM pricing_quotes WHERE request_id=$1', [
      v.request.id,
    ]);
    expect(quotes.rows.find((q) => q.data.itemId === 'res-projector-duri').data).toMatchObject({
      recommendedKrw: 5000,
      recommendationSource: 'AI',
    });
    expect(
      quotes.rows.find((q) => q.data.itemId === 'res-projector-seul').data.recommendationSource,
    ).toBe('BASELINE');
    await db.pool.query('DELETE FROM fee_cache');
  });
  it('NO_CHANGES, fee range and three-change limit enforce exact versions; immutable history retains all revisions', async () => {
    let view = await submit();
    let n = view.negotiations[0]!;
    for (let i = 0; i < 3; i++) {
      const q = await db.transaction((u) =>
        u.issueQuote('u_duri', {
          requestId: view.request.id,
          negotiationId: n.id,
          itemId: n.itemId,
          startAt: n.terms.startAt,
          endAt: n.terms.endAt,
        }),
      );
      const body = {
        action: 'COUNTER' as const,
        expectedNegotiationVersion: n.version,
        expectedTermsRevision: n.termsRevision,
        terms: { ...n.terms, quoteId: q.id },
      };
      await expect(
        db.transaction((u) => u.ownerResponse('u_duri', n.id, body)),
      ).rejects.toMatchObject({ code: 'NO_CHANGES' });
      await expect(
        db.transaction((u) =>
          u.ownerResponse('u_duri', n.id, { ...body, terms: { ...body.terms, totalFeeKrw: 4501 } }),
        ),
      ).rejects.toMatchObject({ code: 'PRICE_OUT_OF_RANGE' });
      const card = await db.transaction((u) =>
        u.ownerResponse('u_duri', n.id, {
          ...body,
          terms: {
            ...body.terms,
            placeId: n.terms.placeId === 'place-center' ? 'place-library' : 'place-center',
          },
        }),
      );
      n = card.negotiation;
    }
    expect(n.changeCount).toBe(3);
    const q = await db.transaction((u) =>
      u.issueQuote('u_duri', {
        requestId: view.request.id,
        negotiationId: n.id,
        itemId: n.itemId,
        startAt: n.terms.startAt,
        endAt: n.terms.endAt,
      }),
    );
    await expect(
      db.transaction((u) =>
        u.ownerResponse('u_duri', n.id, {
          action: 'COUNTER',
          expectedNegotiationVersion: n.version,
          expectedTermsRevision: n.termsRevision,
          terms: { ...n.terms, placeId: 'place-center', quoteId: q.id },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CHANGE_LIMIT_REACHED' });
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM terms_revisions WHERE negotiation_id=$1',
          [n.id],
        )
      ).rows[0].count,
    ).toBe(4);
  });
  it('comparison sorts selectable first, original conditions before price, and records actual changes', async () => {
    const v = await submit('u_hana', ['res-projector-duri', 'res-projector-seul']);
    await owner(v.negotiations.find((n) => n.ownerId === 'u_duri')!);
    await owner(v.negotiations.find((n) => n.ownerId === 'u_seul')!);
    let current = await fresh(v);
    expect(current.comparison[0]!.itemSummary.id).toBe('res-projector-seul');
    const n = current.negotiations.find((n) => n.ownerId === 'u_seul')!;
    const startAt = new Date(Date.parse(n.terms.startAt) + 1800000).toISOString();
    const endAt = new Date(Date.parse(n.terms.endAt) + 1800000).toISOString();
    const q = await db.transaction((u) =>
      u.issueQuote('u_seul', {
        requestId: v.request.id,
        negotiationId: n.id,
        itemId: n.itemId,
        startAt,
        endAt,
      }),
    );
    await db.transaction((u) =>
      u.ownerResponse('u_seul', n.id, {
        action: 'COUNTER',
        expectedNegotiationVersion: n.version,
        expectedTermsRevision: n.termsRevision,
        terms: { ...n.terms, startAt, endAt, quoteId: q.id },
      }),
    );
    current = await fresh(v);
    expect(current.comparison[0]!.itemSummary.id).toBe('res-projector-duri');
    expect(current.comparison[1]!.changedFields).toEqual(['START_AT', 'END_AT']);
  });
  it('decline and withdrawal close all branches into NO_OFFERS and cannot reopen', async () => {
    const v = await submit('u_hana', ['res-projector-duri', 'res-projector-seul']);
    const n = v.negotiations.find((n) => n.ownerId === 'u_duri')!;
    await db.transaction((u) =>
      u.ownerResponse('u_duri', n.id, {
        action: 'DECLINE',
        reasonCode: 'UNAVAILABLE',
        expectedNegotiationVersion: 1,
        expectedTermsRevision: 1,
        terms: null,
      }),
    );
    await db.transaction((u) =>
      u.withdraw('u_hana', v.negotiations.find((n) => n.ownerId === 'u_seul')!.id, 1),
    );
    expect((await fresh(v)).request.status).toBe('NO_OFFERS');
    await expect(owner(n)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('cancel closes branches and discards late search/public effects', async () => {
    const v = await submit('u_hana', ['pub-projector', 'res-projector-duri']);
    const t = v.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
    await db.transaction((u) => u.cancel('u_hana', v.request.id, v.request.version));
    expect(await db.applyPublicDecision(t.id, t.inputVersion)).toBe(false);
    expect((await fresh(v)).negotiations.every((n) => n.status === 'WITHDRAWN')).toBe(true);
    const draft = await db.transaction((u) => u.create('u_hana', need()));
    await db.transaction((u) => u.confirmAndSearch('u_hana', draft.request.id, 1));
    await db.transaction((u) => u.cancel('u_hana', draft.request.id, 2));
    expect(await db.runSearch(draft.request.id, { kind: 'NEED', needRevision: 1 })).toBe(false);
  });
  it('latest-turn and need-reference checks discard stale model results without editing the draft', async () => {
    const v = await db.transaction((u) => u.create('u_hana', createEmptyNeed()));
    const a = await db.transaction((u) =>
      u.agentTurn('u_hana', {
        requestId: v.request.id,
        text: '프로젝터',
        expectedRequestVersion: 1,
      }),
    );
    const ta = await db.getTask(a.taskId);
    const b = await db.transaction((u) =>
      u.agentTurn('u_hana', { requestId: v.request.id, text: '청소기', expectedRequestVersion: 1 }),
    );
    expect(await db.recordTaskResult(a.taskId, ta.inputVersion, { intent: 'RENTAL_REQUEST' })).toBe(
      false,
    );
    const tb = await db.getTask(b.taskId);
    expect(await db.recordTaskResult(b.taskId, tb.inputVersion, { intent: 'RENTAL_REQUEST' })).toBe(
      true,
    );
    expect(await db.recordTaskResult(b.taskId, tb.inputVersion, { intent: 'RENTAL_REQUEST' })).toBe(
      false,
    );
    const result = await fresh(v);
    const extract = result.tasks.find((t) => t.kind === 'EXTRACT_NEED')!;
    expect(extract).toBeDefined();
    await db.recordTaskResult(extract.id, extract.inputVersion, {
      proposedNeed: need(),
      missingFields: [],
      clarificationQuestion: null,
    });
    expect((await fresh(v)).request.need).toEqual(createEmptyNeed());
  });
  it('worker retries stop after three attempts and publish FAILED versus PUBLIC_DEMO_ERROR', async () => {
    const v = await db.transaction((u) => u.create('u_hana', need()));
    const search = await db.transaction((u) => u.confirmAndSearch('u_hana', v.request.id, 1));
    for (let i = 0; i < 3; i++) {
      expect((await db.startTask(search.taskId))!.attempt).toBe(i + 1);
      await db.failTask(search.taskId, 'NETWORK');
    }
    expect((await fresh(v)).request.status).toBe('FAILED');
    const pub = await submit('u_hana', ['pub-projector']);
    const t = pub.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
    await db.failTask(t.id, 'NETWORK', true);
    const final = await fresh(pub);
    expect(final.negotiations[0]!.status).toBe('UNAVAILABLE');
    expect(final.negotiations[0]!.closedReason).toBe('PUBLIC_DEMO_ERROR');
  });
  it('public DECLINE fixture and eligibility checks are deterministic', async () => {
    const v = await submit(
      'u_jun',
      ['pub-ladder'],
      need({ category: 'TOOLS', queryText: '사다리' }),
    );
    const t = v.tasks.find((t) => t.kind === 'PUBLIC_SUBMIT')!;
    await db.applyPublicDecision(t.id, t.inputVersion);
    expect((await fresh(v)).negotiations[0]!.closedReason).toBe('PUBLIC_DEMO_DECLINED');
    await db.pool.query(
      "UPDATE users SET data=jsonb_set(data,'{demoEligible}','false') WHERE id='u_jun'",
    );
    const searched = await search('u_jun');
    expect(searched.candidates.find((c) => c.itemId === 'pub-projector')!.unavailableReason).toBe(
      'DEMO_INELIGIBLE',
    );
    await db.pool.query(
      "UPDATE users SET data=jsonb_set(data,'{demoEligible}','true') WHERE id='u_jun'",
    );
  });
  it('owner response fixture helper is unavailable outside automated-test mode', async () => {
    const v = await submit();
    const n = v.negotiations[0]!;
    const old = process.env.APP_MODE;
    process.env.APP_MODE = 'demo';
    await expect(
      db.injectOwnerResponse('u_duri', n.id, {
        action: 'APPROVE',
        terms: null,
        expectedNegotiationVersion: 1,
        expectedTermsRevision: 1,
      }),
    ).rejects.toThrow('automated-test');
    if (old === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = old;
  });
  it('immutable Offer remains present after changed terms invalidate its reference', async () => {
    const v = await submit();
    const card = await owner(v.negotiations[0]!);
    const n = card.negotiation;
    const q = await db.transaction((u) =>
      u.issueQuote('u_hana', {
        requestId: v.request.id,
        negotiationId: n.id,
        itemId: n.itemId,
        startAt: n.terms.startAt,
        endAt: n.terms.endAt,
      }),
    );
    await db.transaction((u) =>
      u.requesterCounter('u_hana', n.id, {
        expectedNegotiationVersion: n.version,
        expectedTermsRevision: n.termsRevision,
        terms: { ...n.terms, placeId: 'place-library', quoteId: q.id },
      }),
    );
    expect(
      (await db.pool.query('SELECT data FROM offers WHERE id=$1', [n.offer!.id])).rowCount,
    ).toBe(1);
    expect((await fresh(v)).negotiations[0]!.offer).toBeNull();
  });
  it('events have strictly increasing user cursors, omit unrelated owner versions, and failed tx emits nothing', async () => {
    const before = await db.sync('u_hana');
    await expect(
      db.transaction(async (u) => {
        await u.create('u_hana', need());
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await db.sync('u_hana')).eventCursor).toBe(before.eventCursor);
    const v = await submit();
    const events = (await db.eventsAfter('u_hana', before.eventCursor)).events;
    expect(
      events.every((e, i) => i === 0 || BigInt(e.eventId) > BigInt(events[i - 1].eventId)),
    ).toBe(true);
    const own = (await db.eventsAfter('u_duri', '0')).events.filter(
      (e) => e.requestId === v.request.id,
    );
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => !('requestVersion' in e))).toBe(true);
  });
  it('Offer changes enqueue comparison tasks; stale results are discarded and explanation failures keep server templates', async () => {
    const v = await submit('u_hana', ['res-projector-duri', 'res-projector-seul']);
    const duri = await owner(v.negotiations.find((n) => n.ownerId === 'u_duri')!);
    const first = (await fresh(v)).tasks.find((t) => t.kind === 'COMPARE_OFFERS')!;
    await owner(v.negotiations.find((n) => n.ownerId === 'u_seul')!);
    const current = await fresh(v);
    const latest = current.tasks.find((t) => t.kind === 'COMPARE_OFFERS' && t.id !== first.id)!;
    expect((await db.getTaskInput(latest.id))!.kind).toBe('COMPARE_OFFERS');
    expect(
      await db.recordTaskResult(first.id, first.inputVersion, { summary: '오래된 비교', rows: [] }),
    ).toBe(false);
    await expect(
      db.recordTaskResult(latest.id, latest.inputVersion, {
        summary: '잘못된 비교',
        rows: [{ negotiationId: 'neg_unknown', termsRevision: 1, explanation: '잘못된 참조' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await db.failTask(latest.id, 'AI_UNAVAILABLE', true);
    expect(await db.getTask(latest.id, 'u_hana')).toMatchObject({
      status: 'FAILED',
      result: { summary: '도착한 제안의 기간·장소·총액을 비교해 주세요.' },
    });
    const n = duri.negotiation;
    const q = await db.transaction((u) =>
      u.issueQuote('u_duri', {
        requestId: v.request.id,
        negotiationId: n.id,
        itemId: n.itemId,
        startAt: n.terms.startAt,
        endAt: n.terms.endAt,
      }),
    );
    await db.transaction((u) =>
      u.ownerResponse('u_duri', n.id, {
        action: 'COUNTER',
        expectedNegotiationVersion: n.version,
        expectedTermsRevision: n.termsRevision,
        terms: { ...n.terms, placeId: 'place-library', quoteId: q.id },
      }),
    );
    const explain = (await fresh(v)).tasks.find((t) => t.kind === 'EXPLAIN_TERMS')!;
    await db.failTask(explain.id, 'AI_UNAVAILABLE', true);
    expect(await db.getTask(explain.id, 'u_hana')).toMatchObject({
      status: 'FAILED',
      result: { changedFields: ['PLACE'] },
    });
    expect((await fresh(v)).negotiations.find((branch) => branch.id === n.id)!.status).toBe(
      'OFFERED',
    );
  });
  it('outbox persists task delivery and marking delivery is idempotent', async () => {
    const rows = await db.pendingOutbox();
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    await db.markOutboxDelivered(row.id);
    await db.markOutboxDelivered(row.id);
    expect((await db.pendingOutbox()).some((r) => r.id === row.id)).toBe(false);
  });
  it('expiry-fast uses exact >= boundaries; root expiry takes precedence, hold expiry preserves preview', async () => {
    await seed(db.pool, buildSeed({ scenario: 'expiry-fast', now }));
    const v = await submit();
    const card = await owner(v.negotiations[0]!);
    now = new Date(now.getTime() + 30_000);
    await expect(
      db.transaction((u) =>
        u.select('u_hana', v.request.id, {
          expectedRequestVersion: 5,
          negotiationId: card.negotiation.id,
          expectedNegotiationVersion: 2,
          termsRevision: 1,
          offerId: card.negotiation.offer!.id,
          acknowledgeCloseOtherBranches: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    expect((await fresh(v)).request.status).toBe('NO_OFFERS');
    const root = await submit();
    now = new Date(now.getTime() + 90_000);
    await db.expireDue(now);
    expect((await fresh(root)).request.status).toBe('EXPIRED');
    const selected = await submit();
    const ownerCard = await owner(selected.negotiations[0]!);
    const current = await fresh(selected);
    const n = ownerCard.negotiation;
    await db.transaction((u) =>
      u.select('u_hana', selected.request.id, {
        expectedRequestVersion: current.request.version,
        negotiationId: n.id,
        expectedNegotiationVersion: n.version,
        termsRevision: n.termsRevision,
        offerId: n.offer!.id,
        acknowledgeCloseOtherBranches: true,
      }),
    );
    now = new Date(now.getTime() + 30_000);
    const preview = await db.transaction((u) => u.paymentPreview('u_hana', selected.request.id));
    expect(preview.demoHoldStatus).toBe('EXPIRED');
    expect((await fresh(selected)).request.status).toBe('PAYMENT_PREVIEW_READY');
    expect(
      (await db.eventsAfter('u_hana', '0')).events.some((e) => e.type === 'demo_hold.expired'),
    ).toBe(true);
  });
  it('fee recommendations time out after 8 seconds and late AI results cannot mutate the baseline quote', async () => {
    await seed(db.pool, buildSeed({ now }));
    const v = await submit();
    const n = v.negotiations[0]!;
    let resolveLate!: (result: RecommendFeeResult) => void;
    const late = new Promise<RecommendFeeResult>((resolve) => {
      resolveLate = resolve;
    });
    const started = performance.now();
    const startAt = new Date(Date.parse(n.terms.startAt) + 1800000).toISOString();
    const endAt = new Date(Date.parse(n.terms.endAt) + 1800000).toISOString();
    const quote = await db.transaction((u) =>
      u.issueQuote(
        'u_duri',
        { requestId: v.request.id, negotiationId: n.id, itemId: n.itemId, startAt, endAt },
        { recommend: async () => late },
      ),
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(7900);
    expect(performance.now() - started).toBeLessThan(9500);
    expect(quote.recommendationSource).toBe('BASELINE');
    resolveLate({
      feeOptionId: 'UPPER',
      reasonCode: 'REGISTERED_EXTRA_EFFORT',
      reasonText: '늦은 추천',
    });
    await Promise.resolve();
    expect(
      (await db.pool.query('SELECT data FROM pricing_quotes WHERE id=$1', [quote.id])).rows[0].data,
    ).toEqual(quote);
  }, 15000);
  it('ineligible seed changes only demo eligibility and records the scenario', async () => {
    await seed(db.pool, buildSeed({ scenario: 'ineligible', now }));
    const result = await db.transaction((u) => u.createSession('demo-jun'));
    expect(result.data.demoScenario).toBe('ineligible');
    expect(result.data.user.demoEligible).toBe(false);
    const view = await search('u_jun');
    RequestViewSchema.parse(view);
    expect(view.candidates.find((c) => c.itemId === 'pub-projector')!.availability).toBe(
      'UNAVAILABLE',
    );
  });
});
