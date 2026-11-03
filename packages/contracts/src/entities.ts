import { z } from 'zod';
import {
  AllowedActionSchema,
  AvailabilitySchema,
  CategorySchema,
  ChangedFieldSchema,
  DemoHoldStatusSchema,
  EndorsedBySchema,
  ItemSourceSchema,
  NegotiationStatusSchema,
  POLICY_VERSION,
  PricingReasonCodeSchema,
  PublicScenarioSchema,
  RecommendationSourceSchema,
  RequestStatusSchema,
} from './enums.js';
import {
  checkPeriodShape,
  CountSchema,
  CurrencySchema,
  IdSchema,
  ImageSchema,
  KrwSchema,
  NegotiationIdSchema,
  OfferIdSchema,
  QuoteIdSchema,
  RequestIdSchema,
  textSchema,
  UnavailableIntervalSchema,
  UtcDateTimeSchema,
  VersionSchema,
} from './primitives.js';

export const DemoUserSchema = z
  .object({
    id: IdSchema,
    handle: textSchema(64),
    displayName: textSchema(40),
    demoEligible: z.boolean(),
  })
  .strict();
export type DemoUser = z.infer<typeof DemoUserSchema>;
export const PlaceSchema = z
  .object({
    id: IdSchema,
    label: textSchema(80),
    description: textSchema(500),
    isDemo: z.literal(true),
  })
  .strict();
export type Place = z.infer<typeof PlaceSchema>;
export const NeedDraftSchema = z
  .object({
    category: CategorySchema.nullable(),
    queryText: textSchema(200, 0),
    startAt: UtcDateTimeSchema.nullable(),
    endAt: UtcDateTimeSchema.nullable(),
    preferredPlaceIds: z.array(IdSchema).max(3),
    maxBudgetKrw: KrwSchema.nullable(),
  })
  .strict();
export type NeedDraft = z.infer<typeof NeedDraftSchema>;
export const ConfirmedNeedSchema = NeedDraftSchema.extend({
  category: CategorySchema,
  queryText: textSchema(200),
  startAt: UtcDateTimeSchema,
  endAt: UtcDateTimeSchema,
  preferredPlaceIds: z.array(IdSchema).min(1).max(3),
}).superRefine(checkPeriodShape);
export type ConfirmedNeed = z.infer<typeof ConfirmedNeedSchema>;
export type Need = NeedDraft;
export const NeedSchema = NeedDraftSchema;
export const EMPTY_NEED: Readonly<NeedDraft> = Object.freeze({
  category: null,
  queryText: '',
  startAt: null,
  endAt: null,
  preferredPlaceIds: [],
  maxBudgetKrw: null,
});
export const createEmptyNeed = (): NeedDraft => ({ ...EMPTY_NEED, preferredPlaceIds: [] });

export const ItemSchema = z
  .object({
    id: IdSchema,
    source: ItemSourceSchema,
    ownerId: IdSchema.nullable(),
    title: textSchema(120),
    category: CategorySchema,
    image: ImageSchema,
    enabled: z.boolean(),
    allowedPlaceIds: z.array(IdSchema).min(1).max(3),
    dailyRateKrw: KrwSchema,
    pricingFacts: z.object({ registeredExtraEffort: z.boolean() }).strict(),
    unavailableIntervals: z.array(UnavailableIntervalSchema),
    publicScenario: PublicScenarioSchema.nullable(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.source === 'PUBLIC' && item.ownerId !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['ownerId'],
        message: '공공 물품은 소유자 ID가 없습니다.',
      });
    if (item.source === 'RESIDENT' && item.ownerId === null)
      ctx.addIssue({
        code: 'custom',
        path: ['ownerId'],
        message: '주민 물품은 소유자 ID가 필요합니다.',
      });
    if (item.source === 'RESIDENT' && item.publicScenario !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['publicScenario'],
        message: '주민 응답은 공공 fixture를 사용하지 않습니다.',
      });
  });
export type Item = z.infer<typeof ItemSchema>;
export const ItemSummarySchema = z
  .object({
    id: IdSchema,
    title: textSchema(120),
    category: CategorySchema,
    source: ItemSourceSchema,
    ownerDisplayName: textSchema(40).nullable(),
    image: ImageSchema,
  })
  .strict();
export type ItemSummary = z.infer<typeof ItemSummarySchema>;
export const TermsSchema = z
  .object({
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    placeId: IdSchema,
    totalFeeKrw: KrwSchema,
    currency: CurrencySchema,
    quoteId: QuoteIdSchema,
  })
  .strict()
  .superRefine(checkPeriodShape);
export type Terms = z.infer<typeof TermsSchema>;
export const RentalRequestSchema = z
  .object({
    id: RequestIdSchema,
    requesterId: IdSchema,
    version: VersionSchema,
    needRevision: VersionSchema,
    status: RequestStatusSchema,
    need: NeedDraftSchema,
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
    expiresAt: UtcDateTimeSchema,
    selectedNegotiationId: NegotiationIdSchema.nullable(),
  })
  .strict();
export type RentalRequest = z.infer<typeof RentalRequestSchema>;
export const CandidateSchema = z
  .object({
    id: IdSchema,
    requestId: RequestIdSchema,
    itemId: IdSchema,
    itemSummary: ItemSummarySchema,
    quoteId: QuoteIdSchema,
    suggestedTerms: TermsSchema,
    availability: AvailabilitySchema,
    unavailableReason: textSchema(300).nullable(),
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;
export const PricingQuoteSchema = z
  .object({
    id: QuoteIdSchema,
    itemId: IdSchema,
    requestId: RequestIdSchema,
    negotiationId: NegotiationIdSchema.nullable(),
    conditionsHash: textSchema(128),
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    billingDays: z.number().int().min(1).max(7),
    baselineKrw: KrwSchema,
    minKrw: KrwSchema,
    maxKrw: KrwSchema,
    recommendedKrw: KrwSchema,
    recommendationSource: RecommendationSourceSchema,
    reasonCode: PricingReasonCodeSchema,
    policyVersion: z.literal(POLICY_VERSION),
    createdAt: UtcDateTimeSchema,
    expiresAt: UtcDateTimeSchema,
  })
  .strict()
  .superRefine(checkPeriodShape);
export type PricingQuote = z.infer<typeof PricingQuoteSchema>;
export const OfferSchema = z
  .object({
    id: OfferIdSchema,
    negotiationId: NegotiationIdSchema,
    termsRevision: VersionSchema,
    terms: TermsSchema,
    endorsedBy: EndorsedBySchema,
    createdAt: UtcDateTimeSchema,
    validUntil: UtcDateTimeSchema,
  })
  .strict();
export type Offer = z.infer<typeof OfferSchema>;
export const NegotiationSchema = z
  .object({
    id: NegotiationIdSchema,
    requestId: RequestIdSchema,
    itemId: IdSchema,
    ownerId: IdSchema.nullable(),
    source: ItemSourceSchema,
    version: VersionSchema,
    status: NegotiationStatusSchema,
    termsRevision: VersionSchema,
    terms: TermsSchema,
    changeCount: z.number().int().min(0).max(3),
    responseDueAt: UtcDateTimeSchema.nullable(),
    offer: OfferSchema.nullable(),
    closedReason: textSchema(100).nullable(),
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type Negotiation = z.infer<typeof NegotiationSchema>;
export const DemoHoldSchema = z
  .object({
    id: IdSchema,
    requestId: RequestIdSchema,
    negotiationId: NegotiationIdSchema,
    itemId: IdSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    expiresAt: UtcDateTimeSchema,
    status: DemoHoldStatusSchema,
  })
  .strict()
  .superRefine(checkPeriodShape);
export type DemoHold = z.infer<typeof DemoHoldSchema>;
export const ComparisonRowSchema = z
  .object({
    negotiationId: NegotiationIdSchema,
    status: NegotiationStatusSchema,
    itemSummary: ItemSummarySchema,
    terms: TermsSchema,
    changedFields: z.array(ChangedFieldSchema),
    validUntil: UtcDateTimeSchema.nullable(),
    selectable: z.boolean(),
    unavailableReason: textSchema(300).nullable(),
  })
  .strict();
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;
export const OwnerCardSchema = z
  .object({
    requestId: RequestIdSchema,
    requesterDisplayName: textSchema(40),
    negotiation: NegotiationSchema,
    itemSummary: ItemSummarySchema,
    allowedActions: z.array(AllowedActionSchema),
  })
  .strict();
export type OwnerCard = z.infer<typeof OwnerCardSchema>;
export const RequestSummarySchema = z
  .object({
    id: RequestIdSchema,
    status: RequestStatusSchema,
    version: VersionSchema,
    needSummary: NeedDraftSchema.pick({
      category: true,
      queryText: true,
      startAt: true,
      endAt: true,
    }),
    activeBranchCount: CountSchema.max(3),
    offeredCount: CountSchema.max(3),
    selectedNegotiationId: NegotiationIdSchema.nullable(),
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type RequestSummary = z.infer<typeof RequestSummarySchema>;
export const PaymentPreviewSchema = z
  .object({
    mode: z.literal('PREVIEW_ONLY'),
    requestId: RequestIdSchema,
    negotiationId: NegotiationIdSchema,
    offerId: OfferIdSchema,
    termsRevision: VersionSchema,
    totalFeeKrw: KrwSchema,
    currency: CurrencySchema,
    chargeable: z.literal(false),
    paymentStatus: z.literal('NOT_APPLICABLE'),
    demoHoldStatus: DemoHoldStatusSchema,
    demoHoldExpiresAt: UtcDateTimeSchema,
    notice: textSchema(500),
    itemSummary: ItemSummarySchema,
    terms: TermsSchema,
  })
  .strict();
export type PaymentPreview = z.infer<typeof PaymentPreviewSchema>;
