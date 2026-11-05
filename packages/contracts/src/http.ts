import { z } from 'zod';
import {
  AllowedActionSchema,
  CategorySchema,
  CenterContentTypeSchema,
  CONTRACT_VERSION,
  DemoScenarioSchema,
  ErrorCodeSchema,
  InboxRoleSchema,
  ItemSourceSchema,
  OwnerReasonCodeSchema,
  SseEventTypeSchema,
} from './enums.js';
import { AgentTaskSchema } from './ai.js';
import {
  CandidateSchema,
  DemoUserSchema,
  ComparisonRowSchema,
  NeedDraftSchema,
  NegotiationSchema,
  OwnerCardSchema,
  PaymentPreviewSchema,
  RentalRequestSchema,
  RequestSummarySchema,
  TermsSchema,
} from './entities.js';
import {
  checkPeriodShape,
  CountSchema,
  EventCursorSchema,
  IdSchema,
  ImageSchema,
  KrwSchema,
  NegotiationIdSchema,
  NotificationIdSchema,
  OfferIdSchema,
  QuoteIdSchema,
  RequestIdSchema,
  ReservationIdSchema,
  TaskIdSchema,
  textSchema,
  UtcDateTimeSchema,
  VersionSchema,
  VoiceSessionIdSchema,
  WaitlistEntryIdSchema,
} from './primitives.js';

export const RequestViewSchema = z
  .object({
    request: RentalRequestSchema,
    candidates: z.array(CandidateSchema),
    negotiations: z.array(NegotiationSchema).max(3),
    comparison: z.array(ComparisonRowSchema).max(3),
    tasks: z.array(AgentTaskSchema),
    allowedActions: z.array(AllowedActionSchema),
  })
  .strict();
export type RequestView = z.infer<typeof RequestViewSchema>;
export const MetaSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    serverTime: UtcDateTimeSchema,
    traceId: IdSchema,
  })
  .strict();
export type Meta = z.infer<typeof MetaSchema>;
export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: MetaSchema }).strict();
export type SuccessEnvelope<T> = { data: T; meta: Meta };
export const listDataSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: textSchema(2_048).nullable() }).strict();
export type ListData<T> = { items: T[]; nextCursor: string | null };
export const ErrorDetailsSchema = z.record(z.string(), z.json());
export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: textSchema(1_000),
        retryable: z.boolean(),
        details: ErrorDetailsSchema,
      })
      .strict(),
    meta: MetaSchema,
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const DemoSessionBodySchema = z.object({ handle: textSchema(64) }).strict();
export type DemoSessionBody = z.infer<typeof DemoSessionBodySchema>;
export const DemoSessionDataSchema = z
  .object({
    user: DemoUserSchema,
    csrfToken: textSchema(512),
    sessionExpiresAt: UtcDateTimeSchema,
    demoScenario: DemoScenarioSchema.optional(),
  })
  .strict();
export type DemoSessionData = z.infer<typeof DemoSessionDataSchema>;
export const CreateRequestBodySchema = z.object({ need: NeedDraftSchema }).strict();
export type CreateRequestBody = z.infer<typeof CreateRequestBodySchema>;
export const PatchDraftBodySchema = z
  .object({ expectedRequestVersion: VersionSchema, need: NeedDraftSchema })
  .strict();
export type PatchDraftBody = z.infer<typeof PatchDraftBodySchema>;
export const RequestVersionBodySchema = z
  .object({ expectedRequestVersion: VersionSchema })
  .strict();
export type RequestVersionBody = z.infer<typeof RequestVersionBodySchema>;
export const SearchRequestBodySchema = RequestVersionBodySchema;
export type SearchRequestBody = RequestVersionBody;
export const CancelRequestBodySchema = RequestVersionBodySchema;
export type CancelRequestBody = RequestVersionBody;
export const CandidateSelectionSchema = z
  .object({ candidateId: IdSchema, quoteId: QuoteIdSchema, totalFeeKrw: KrwSchema })
  .strict();
export type CandidateSelection = z.infer<typeof CandidateSelectionSchema>;
export const SubmitRequestBodySchema = z
  .object({
    expectedRequestVersion: VersionSchema,
    selections: z.array(CandidateSelectionSchema).min(1).max(3),
  })
  .strict()
  .refine(
    (body) =>
      new Set(body.selections.map((selection) => selection.candidateId)).size ===
      body.selections.length,
    { path: ['selections'], message: '같은 후보를 중복 전송할 수 없습니다.' },
  );
export type SubmitRequestBody = z.infer<typeof SubmitRequestBodySchema>;
export const PriceQuoteBodySchema = z
  .object({
    requestId: RequestIdSchema,
    negotiationId: NegotiationIdSchema.nullable(),
    itemId: IdSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
  })
  .strict()
  .superRefine(checkPeriodShape);
export type PriceQuoteBody = z.infer<typeof PriceQuoteBodySchema>;
const expectedTerms = {
  expectedNegotiationVersion: VersionSchema,
  expectedTermsRevision: VersionSchema,
};
export const OwnerResponseBodySchema = z.discriminatedUnion('action', [
  z
    .object({
      ...expectedTerms,
      action: z.literal('APPROVE'),
      terms: z.null(),
      reasonCode: OwnerReasonCodeSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...expectedTerms,
      action: z.literal('DECLINE'),
      terms: z.null(),
      reasonCode: OwnerReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      ...expectedTerms,
      action: z.literal('COUNTER'),
      terms: TermsSchema,
      reasonCode: OwnerReasonCodeSchema.optional(),
    })
    .strict(),
]);
export type OwnerResponseBody = z.infer<typeof OwnerResponseBodySchema>;
export const RequesterCounterBodySchema = z
  .object({ ...expectedTerms, terms: TermsSchema, reasonCode: OwnerReasonCodeSchema.optional() })
  .strict();
export type RequesterCounterBody = z.infer<typeof RequesterCounterBodySchema>;
export const WithdrawBodySchema = z.object({ expectedNegotiationVersion: VersionSchema }).strict();
export type WithdrawBody = z.infer<typeof WithdrawBodySchema>;
export const SelectOfferBodySchema = z
  .object({
    expectedRequestVersion: VersionSchema,
    negotiationId: NegotiationIdSchema,
    expectedNegotiationVersion: VersionSchema,
    offerId: OfferIdSchema,
    termsRevision: VersionSchema,
    acknowledgeCloseOtherBranches: z.literal(true),
  })
  .strict();
export type SelectOfferBody = z.infer<typeof SelectOfferBodySchema>;
export const VoiceSessionBodySchema = z
  .object({
    requestId: RequestIdSchema,
    sdpOffer: z.string().min(1).max(100_000),
  })
  .strict();
export type VoiceSessionBody = z.infer<typeof VoiceSessionBodySchema>;
export const VoiceSessionDataSchema = z
  .object({ voiceSessionId: VoiceSessionIdSchema, sdpAnswer: z.string().min(1).max(100_000) })
  .strict();
export type VoiceSessionData = z.infer<typeof VoiceSessionDataSchema>;
export const VoiceCompletionSchema = z
  .object({
    taskId: TaskIdSchema,
    inputRevision: z.number().int().positive(),
    requestVersion: VersionSchema,
  })
  .strict();
export type VoiceCompletion = z.infer<typeof VoiceCompletionSchema>;
/** Fixed notice shared with playback verification, never supplied by model output. */
export const VOICE_COMPLETION_NOTICE =
  '필요한 정보를 모두 모았어요. 이제 통화를 종료하고 물품을 조회할게요. 결과는 요청함에서 확인해 주세요.';
export const VoiceStateDataSchema = z
  .object({
    inputRevision: z.number().int().nonnegative(),
    turnStatus: z.enum(['WAITING', 'READY', 'BLOCKED']),
    taskId: TaskIdSchema.nullable(),
    active: z.boolean(),
    completion: VoiceCompletionSchema.nullable(),
  })
  .strict();
export const VoiceCompletionAudioQuerySchema = z
  .object({
    taskId: TaskIdSchema,
    inputRevision: z.coerce.number().int().positive(),
  })
  .strict();
export const VoiceCompletionAudioDataSchema = z
  .object({
    completion: VoiceCompletionSchema,
    audioWav: z.string().min(1).max(2_000_000).nullable(),
  })
  .strict();
export const VoiceRespondBodySchema = z
  .object({ inputRevision: z.number().int().positive(), completionTaskId: TaskIdSchema.optional() })
  .strict();
export const FinishVoiceBodySchema = RequestVersionBodySchema.extend({
  completion: VoiceCompletionSchema.optional(),
}).strict();
export const AgentTurnBodySchema = z
  .object({
    requestId: RequestIdSchema,
    text: textSchema(2_000),
    expectedRequestVersion: VersionSchema,
  })
  .strict();
export type AgentTurnBody = z.infer<typeof AgentTurnBodySchema>;
export const TaskAcceptedDataSchema = z.object({ taskId: TaskIdSchema }).strict();
export type TaskAcceptedData = z.infer<typeof TaskAcceptedDataSchema>;
export const SearchAcceptedDataSchema = z
  .object({ request: RequestViewSchema, taskId: TaskIdSchema })
  .strict();
export type SearchAcceptedData = z.infer<typeof SearchAcceptedDataSchema>;
export const SelectOfferDataSchema = z
  .object({ request: RequestViewSchema, paymentPreview: PaymentPreviewSchema })
  .strict();
export type SelectOfferData = z.infer<typeof SelectOfferDataSchema>;
export const NegotiationDetailSchema = z.union([NegotiationSchema, OwnerCardSchema]);
export type NegotiationDetail = z.infer<typeof NegotiationDetailSchema>;
export const WithdrawDataSchema = z.union([RequestViewSchema, OwnerCardSchema]);
export const InboxItemSchema = z.union([RequestSummarySchema, OwnerCardSchema]);
export const PaginationQuerySchema = z
  .object({
    cursor: textSchema(2_048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const ItemsQuerySchema = PaginationQuerySchema.extend({
  category: CategorySchema.optional(),
  source: ItemSourceSchema.optional(),
});
export type ItemsQuery = z.infer<typeof ItemsQuerySchema>;
export const InboxQuerySchema = PaginationQuerySchema.extend({ role: InboxRoleSchema });
export type InboxQuery = z.infer<typeof InboxQuerySchema>;
export const EventsQuerySchema = z.object({ after: EventCursorSchema.optional() }).strict();
export const SyncDataSchema = z
  .object({
    requestSummaries: z.array(RequestSummarySchema),
    ownerCards: z.array(OwnerCardSchema),
    tasks: z.array(AgentTaskSchema),
    eventCursor: EventCursorSchema,
  })
  .strict();
export type SyncData = z.infer<typeof SyncDataSchema>;
export const SseEventSchema = z
  .object({
    eventId: EventCursorSchema,
    eventVersion: z.literal(1),
    type: SseEventTypeSchema.exclude(['heartbeat']),
    occurredAt: UtcDateTimeSchema,
    requestId: RequestIdSchema.optional(),
    requestVersion: VersionSchema.optional(),
    negotiationId: NegotiationIdSchema.optional(),
    negotiationVersion: VersionSchema.optional(),
    taskId: TaskIdSchema.optional(),
    reservationId: ReservationIdSchema.optional(),
    waitlistEntryId: WaitlistEntryIdSchema.optional(),
    notificationId: NotificationIdSchema.optional(),
    reason: textSchema(100).optional(),
  })
  .strict();
export type SseEvent = z.infer<typeof SseEventSchema>;
export const HeartbeatSchema = z.object({ serverTime: UtcDateTimeSchema }).strict();
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export const CenterContentSchema = z
  .object({
    id: IdSchema,
    type: CenterContentTypeSchema,
    title: textSchema(200),
    summary: textSchema(1_000),
    body: textSchema(30_000),
    images: z.array(ImageSchema),
    sourceUrl: z.url().max(2_048),
    isDemo: z.boolean(),
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type CenterContent = z.infer<typeof CenterContentSchema>;
export const AssetMetadataSchema = z
  .object({
    id: IdSchema,
    src: textSchema(2_048),
    width: CountSchema.positive(),
    height: CountSchema.positive(),
    alt: textSchema(300, 0),
    decorative: z.boolean(),
    license: textSchema(500),
    creator: textSchema(200),
    format: textSchema(40),
    byteSize: CountSchema,
  })
  .strict();
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;
