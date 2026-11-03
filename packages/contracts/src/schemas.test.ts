import { describe, expect, it } from 'vitest';
import {
  AgentTaskSchema,
  AgentTaskDetailSchema,
  AI_RESULT_JSON_SCHEMAS,
  AgentTurnBodySchema,
  ConfirmedNeedSchema,
  CreateRequestBodySchema,
  createEmptyNeed,
  DemoSessionBodySchema,
  ErrorCodeSchema,
  ERROR_HTTP_STATUS,
  ItemSchema,
  KrwSchema,
  NeedDraftSchema,
  OwnerResponseBodySchema,
  PaymentPreviewSchema,
  SelectOfferBodySchema,
  SubmitRequestBodySchema,
  VoiceStatusSchema,
  VoiceSessionBodySchema,
} from './index.js';

const terms = {
  startAt: '2026-11-07T01:00:00Z',
  endAt: '2026-11-08T07:00:00Z',
  placeId: 'place-center',
  totalFeeKrw: 3000,
  currency: 'KRW',
  quoteId: 'quote_one',
} as const;
const image = {
  url: '/assets/items/pub-projector.svg',
  alt: '프로젝터 일러스트',
  isIllustration: true,
};
describe('draft and write boundaries', () => {
  it('accepts exactly the empty draft but blocks search until complete', () => {
    expect(NeedDraftSchema.parse(createEmptyNeed())).toEqual(createEmptyNeed());
    expect(ConfirmedNeedSchema.safeParse(createEmptyNeed()).success).toBe(false);
    expect(NeedDraftSchema.safeParse({}).success).toBe(false);
    expect(
      ConfirmedNeedSchema.parse({
        category: 'HOBBY',
        queryText: '  프로젝터  ',
        startAt: terms.startAt,
        endAt: terms.endAt,
        preferredPlaceIds: ['place-center'],
        maxBudgetKrw: null,
      }).queryText,
    ).toBe('프로젝터');
  });
  it('rejects actor injection at root and nested levels', () => {
    expect(
      CreateRequestBodySchema.safeParse({ need: createEmptyNeed(), requesterId: 'u_duri' }).success,
    ).toBe(false);
    expect(
      CreateRequestBodySchema.safeParse({ need: { ...createEmptyNeed(), quantity: 2 } }).success,
    ).toBe(false);
    expect(
      AgentTurnBodySchema.safeParse({
        requestId: 'req_one',
        text: '대여',
        expectedRequestVersion: 1,
        ownerId: 'u_duri',
      }).success,
    ).toBe(false);
  });
  it('trims ordinary strings and limits text lengths', () => {
    expect(DemoSessionBodySchema.parse({ handle: ' demo-hana ' }).handle).toBe('demo-hana');
    expect(
      NeedDraftSchema.safeParse({ ...createEmptyNeed(), queryText: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      AgentTurnBodySchema.safeParse({ requestId: 'req_one', text: ' ', expectedRequestVersion: 1 })
        .success,
    ).toBe(false);
  });
  it('preserves SDP framing while rejecting a null request ID', () => {
    const body = { requestId: 'req_one', sdpOffer: 'v=0\r\n' };
    expect(VoiceSessionBodySchema.parse(body)).toEqual(body);
    expect(VoiceSessionBodySchema.safeParse({ ...body, requestId: null }).success).toBe(false);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid KRW %s',
    (amount) => expect(KrwSchema.safeParse(amount).success).toBe(false),
  );
  it('requires complete conditions only for COUNTER and reason for DECLINE', () => {
    const common = { expectedNegotiationVersion: 1, expectedTermsRevision: 1 };
    expect(
      OwnerResponseBodySchema.safeParse({ ...common, action: 'APPROVE', terms: null }).success,
    ).toBe(true);
    expect(OwnerResponseBodySchema.safeParse({ ...common, action: 'APPROVE', terms }).success).toBe(
      false,
    );
    expect(
      OwnerResponseBodySchema.safeParse({ ...common, action: 'DECLINE', terms: null }).success,
    ).toBe(false);
    expect(
      OwnerResponseBodySchema.safeParse({
        ...common,
        action: 'DECLINE',
        terms: null,
        reasonCode: 'UNAVAILABLE',
      }).success,
    ).toBe(true);
    expect(OwnerResponseBodySchema.safeParse({ ...common, action: 'COUNTER', terms }).success).toBe(
      true,
    );
    expect(
      OwnerResponseBodySchema.safeParse({
        ...common,
        action: 'COUNTER',
        terms: { totalFeeKrw: 3000 },
      }).success,
    ).toBe(false);
    expect(
      OwnerResponseBodySchema.safeParse({
        action: 'APPROVE',
        expectedNegotiationVersion: 1,
        terms: null,
      }).success,
    ).toBe(false);
  });
  it('enforces 1–3 distinct selections and explicit final confirmation', () => {
    const selection = { candidateId: 'candidate_a', quoteId: 'quote_one', totalFeeKrw: 3000 };
    expect(
      SubmitRequestBodySchema.safeParse({ expectedRequestVersion: 1, selections: [] }).success,
    ).toBe(false);
    expect(
      SubmitRequestBodySchema.safeParse({
        expectedRequestVersion: 1,
        selections: [selection, selection],
      }).success,
    ).toBe(false);
    expect(
      SubmitRequestBodySchema.safeParse({ expectedRequestVersion: 1, selections: [selection] })
        .success,
    ).toBe(true);
    expect(
      SelectOfferBodySchema.safeParse({
        expectedRequestVersion: 1,
        negotiationId: 'neg_one',
        expectedNegotiationVersion: 1,
        offerId: 'offer_one',
        termsRevision: 1,
        acknowledgeCloseOtherBranches: false,
      }).success,
    ).toBe(false);
  });
});
describe('semantic boundaries', () => {
  it('keeps public/resident ownership distinct', () => {
    const item = {
      id: 'pub-projector',
      source: 'PUBLIC',
      ownerId: null,
      title: '프로젝터',
      category: 'HOBBY',
      image,
      enabled: true,
      allowedPlaceIds: ['place-center'],
      dailyRateKrw: 1500,
      pricingFacts: { registeredExtraEffort: false },
      unavailableIntervals: [],
      publicScenario: 'APPROVE',
    };
    expect(ItemSchema.safeParse(item).success).toBe(true);
    expect(ItemSchema.safeParse({ ...item, ownerId: 'u_duri' }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...item, source: 'RESIDENT' }).success).toBe(false);
  });
  it('only permits payment preview with no charge', () => {
    const preview = {
      mode: 'PREVIEW_ONLY',
      requestId: 'req_one',
      negotiationId: 'neg_one',
      offerId: 'offer_one',
      termsRevision: 1,
      totalFeeKrw: 3000,
      currency: 'KRW',
      chargeable: false,
      paymentStatus: 'NOT_APPLICABLE',
      demoHoldStatus: 'ACTIVE',
      demoHoldExpiresAt: '2026-11-01T01:10:00Z',
      notice: '실제 결제와 예약이 이루어지지 않습니다.',
      itemSummary: {
        id: 'pub-projector',
        title: '프로젝터',
        category: 'HOBBY',
        source: 'PUBLIC',
        ownerDisplayName: null,
        image,
      },
      terms,
    };
    expect(PaymentPreviewSchema.safeParse(preview).success).toBe(true);
    expect(PaymentPreviewSchema.safeParse({ ...preview, chargeable: true }).success).toBe(false);
    expect(PaymentPreviewSchema.safeParse({ ...preview, paymentStatus: 'PAID' }).success).toBe(
      false,
    );
  });
  it('requires kind-specific worker input references', () => {
    const task = {
      id: 'task_one',
      kind: 'SEARCH',
      requestId: 'req_one',
      negotiationId: null,
      inputVersion: { kind: 'NEED', needRevision: 1 },
      status: 'QUEUED',
      attempt: 0,
      errorCode: null,
    };
    expect(AgentTaskSchema.safeParse(task).success).toBe(true);
    expect(
      AgentTaskSchema.safeParse({ ...task, inputVersion: { kind: 'TURN', turnId: 'turn_one' } })
        .success,
    ).toBe(false);
  });
  it('uses the exact error mapping and contract voice state', () => {
    expect(ErrorCodeSchema.options).toHaveLength(20);
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.OFFER_EXPIRED).toBe(410);
    expect(VoiceStatusSchema.safeParse('CONNECTED').success).toBe(false);
  });
  it('rejects a valid AI result attached to the wrong task kind', () => {
    const task = {
      id: 'task_route',
      kind: 'ROUTE_INTENT',
      requestId: 'req_one',
      negotiationId: null,
      inputVersion: { kind: 'TURN', turnId: 'turn_one' },
      status: 'SUCCEEDED',
      attempt: 1,
      errorCode: null,
      result: { intent: 'RENTAL_REQUEST' },
    };
    expect(AgentTaskDetailSchema.safeParse(task).success).toBe(true);
    expect(
      AgentTaskDetailSchema.safeParse({ ...task, result: { summary: '비교', rows: [] } }).success,
    ).toBe(false);
  });
  it('exports strict, fully required Structured Outputs objects', () => {
    function inspect(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      const schema = value as Record<string, unknown>;
      if (schema.type === 'object' && schema.properties) {
        expect(schema.additionalProperties).toBe(false);
        expect(new Set(schema.required as string[])).toEqual(
          new Set(Object.keys(schema.properties)),
        );
      }
      for (const child of Object.values(schema)) {
        if (Array.isArray(child)) child.forEach(inspect);
        else inspect(child);
      }
    }
    for (const schema of Object.values(AI_RESULT_JSON_SCHEMAS)) inspect(schema);
    expect(AI_RESULT_JSON_SCHEMAS.RECOMMEND_FEE.properties).not.toHaveProperty('amount');
  });
});
