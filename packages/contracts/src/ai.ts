import { z } from 'zod';
import {
  AgentTaskKindSchema,
  AgentTaskStatusSchema,
  ChangedFieldSchema,
  FeeOptionIdSchema,
  IntentSchema,
  NeedFieldSchema,
  POLICY_VERSION,
  PricingReasonCodeSchema,
} from './enums.js';
import {
  ConfirmedNeedSchema,
  ItemSchema,
  ItemSummarySchema,
  NeedDraftSchema,
  PlaceSchema,
  TermsSchema,
} from './entities.js';
import {
  CountSchema,
  IdSchema,
  KrwSchema,
  NegotiationIdSchema,
  OfferIdSchema,
  RequestIdSchema,
  TaskIdSchema,
  textSchema,
  UtcDateTimeSchema,
  VersionSchema,
} from './primitives.js';

export const TurnInputVersionSchema = z
  .object({ kind: z.literal('TURN'), turnId: IdSchema })
  .strict();
export const NeedInputVersionSchema = z
  .object({ kind: z.literal('NEED'), needRevision: VersionSchema, turnId: IdSchema })
  .strict();
export const SearchInputVersionSchema = z
  .object({ kind: z.literal('NEED'), needRevision: VersionSchema })
  .strict();
export const TermsInputVersionSchema = z
  .object({
    kind: z.literal('TERMS'),
    negotiationId: NegotiationIdSchema,
    termsRevision: VersionSchema,
  })
  .strict();
export const FeeInputVersionSchema = z
  .object({
    kind: z.literal('FEE'),
    conditionsHash: textSchema(128),
    policyVersion: z.literal(POLICY_VERSION),
  })
  .strict();
export const NegotiationInputVersionSchema = z
  .object({
    kind: z.literal('NEGOTIATION'),
    negotiationId: NegotiationIdSchema,
    negotiationVersion: VersionSchema,
    termsRevision: VersionSchema,
  })
  .strict();
export const CompareOfferReferenceSchema = z
  .object({
    negotiationId: NegotiationIdSchema,
    offerId: OfferIdSchema,
    termsRevision: VersionSchema,
  })
  .strict();
export const CompareInputVersionSchema = z
  .object({ kind: z.literal('COMPARE'), offers: z.array(CompareOfferReferenceSchema).max(3) })
  .strict();
export const InputVersionSchema = z.union([
  TurnInputVersionSchema,
  NeedInputVersionSchema,
  SearchInputVersionSchema,
  TermsInputVersionSchema,
  FeeInputVersionSchema,
  NegotiationInputVersionSchema,
  CompareInputVersionSchema,
]);
export type InputVersion = z.infer<typeof InputVersionSchema>;

export const TASK_INPUT_VERSION_SCHEMAS = {
  ROUTE_INTENT: TurnInputVersionSchema,
  EXTRACT_NEED: NeedInputVersionSchema,
  SEARCH: SearchInputVersionSchema,
  PUBLIC_SUBMIT: TermsInputVersionSchema,
  RECOMMEND_FEE: FeeInputVersionSchema,
  EXPLAIN_TERMS: NegotiationInputVersionSchema,
  COMPARE_OFFERS: CompareInputVersionSchema,
} as const;
export const AgentTaskSchema = z
  .object({
    id: TaskIdSchema,
    kind: AgentTaskKindSchema,
    requestId: RequestIdSchema.nullable(),
    negotiationId: NegotiationIdSchema.nullable(),
    inputVersion: InputVersionSchema,
    status: AgentTaskStatusSchema,
    attempt: CountSchema.max(3),
    errorCode: textSchema(100).nullable(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (!TASK_INPUT_VERSION_SCHEMAS[task.kind].safeParse(task.inputVersion).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputVersion'],
        message: '작업 종류와 입력 버전 참조가 일치해야 합니다.',
      });
    }
  });
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const RouteIntentResultSchema = z.object({ intent: IntentSchema }).strict();
export type RouteIntentResult = z.infer<typeof RouteIntentResultSchema>;
export const ExtractNeedResultSchema = z
  .object({
    proposedNeed: NeedDraftSchema,
    missingFields: z.array(NeedFieldSchema),
    clarificationQuestion: textSchema(1_000).nullable(),
  })
  .strict();
export type ExtractNeedResult = z.infer<typeof ExtractNeedResultSchema>;
export const RecommendFeeResultSchema = z
  .object({
    feeOptionId: FeeOptionIdSchema,
    reasonCode: PricingReasonCodeSchema,
    reasonText: textSchema(500),
  })
  .strict();
export type RecommendFeeResult = z.infer<typeof RecommendFeeResultSchema>;
export const ExplainTermsResultSchema = z
  .object({ summary: textSchema(2_000), changedFields: z.array(ChangedFieldSchema) })
  .strict();
export type ExplainTermsResult = z.infer<typeof ExplainTermsResultSchema>;
export const CompareOffersResultSchema = z
  .object({
    summary: textSchema(2_000),
    rows: z
      .array(
        z
          .object({
            negotiationId: NegotiationIdSchema,
            termsRevision: VersionSchema,
            explanation: textSchema(1_000),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type CompareOffersResult = z.infer<typeof CompareOffersResultSchema>;
export const AiResultSchema = z.union([
  RouteIntentResultSchema,
  ExtractNeedResultSchema,
  RecommendFeeResultSchema,
  ExplainTermsResultSchema,
  CompareOffersResultSchema,
]);
export type AiResult = z.infer<typeof AiResultSchema>;
export const AI_RESULT_SCHEMAS = {
  ROUTE_INTENT: RouteIntentResultSchema,
  EXTRACT_NEED: ExtractNeedResultSchema,
  RECOMMEND_FEE: RecommendFeeResultSchema,
  EXPLAIN_TERMS: ExplainTermsResultSchema,
  COMPARE_OFFERS: CompareOffersResultSchema,
} as const;
export const AgentTaskDetailSchema = AgentTaskSchema.safeExtend({
  result: AiResultSchema.nullable(),
}).superRefine((task, ctx) => {
  if (task.result === null) return;
  const schema = AI_RESULT_SCHEMAS[task.kind as keyof typeof AI_RESULT_SCHEMAS];
  if (!schema || !schema.safeParse(task.result).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['result'],
      message: '작업 종류와 결과 형식이 일치해야 합니다.',
    });
  }
});
export type AgentTaskDetail = z.infer<typeof AgentTaskDetailSchema>;

const commonInput = {
  taskId: TaskIdSchema,
  actorUserId: IdSchema,
  requestId: RequestIdSchema,
  negotiationId: NegotiationIdSchema.nullable(),
  locale: z.literal('ko-KR'),
  timeZone: z.literal('Asia/Seoul'),
  serverNow: UtcDateTimeSchema,
};
export const RouteIntentInputSchema = z
  .object({
    ...commonInput,
    kind: z.literal('ROUTE_INTENT'),
    inputVersion: TurnInputVersionSchema,
    context: z
      .object({
        text: textSchema(2_000),
        currentScreen: textSchema(200),
        allowedRoutes: z.array(textSchema(200)).max(30),
      })
      .strict(),
  })
  .strict();
export type RouteIntentInput = z.infer<typeof RouteIntentInputSchema>;
export const ExtractNeedInputSchema = z
  .object({
    ...commonInput,
    kind: z.literal('EXTRACT_NEED'),
    inputVersion: NeedInputVersionSchema,
    context: z
      .object({
        text: textSchema(2_000),
        draft: NeedDraftSchema,
        // This is the complete server-owned directory, not the user's <=3 preferences.
        places: z.array(PlaceSchema),
      })
      .strict(),
  })
  .strict();
export type ExtractNeedInput = z.infer<typeof ExtractNeedInputSchema>;
export const FeeOptionsSchema = z
  .object({ LOWER: KrwSchema, STANDARD: KrwSchema, UPPER: KrwSchema })
  .strict();
export type FeeOptions = z.infer<typeof FeeOptionsSchema>;
export const RecommendFeeInputSchema = z
  .object({
    ...commonInput,
    kind: z.literal('RECOMMEND_FEE'),
    inputVersion: FeeInputVersionSchema,
    context: z
      .object({
        item: z
          .object({
            id: IdSchema,
            title: ItemSchema.shape.title,
            source: ItemSchema.shape.source,
            pricingFacts: ItemSchema.shape.pricingFacts,
          })
          .strict(),
        startAt: UtcDateTimeSchema,
        endAt: UtcDateTimeSchema,
        feeOptions: FeeOptionsSchema,
        allowedReasonCodes: z.array(PricingReasonCodeSchema).min(1).max(3),
        preferredPlaceCount: z.number().int().min(1).max(3),
      })
      .strict(),
  })
  .strict();
export type RecommendFeeInput = z.infer<typeof RecommendFeeInputSchema>;
export const ExplainTermsInputSchema = z
  .object({
    ...commonInput,
    kind: z.literal('EXPLAIN_TERMS'),
    inputVersion: NegotiationInputVersionSchema,
    context: z.object({ oldTerms: TermsSchema, newTerms: TermsSchema }).strict(),
  })
  .strict();
export type ExplainTermsInput = z.infer<typeof ExplainTermsInputSchema>;
export const CompareOfferInputSchema = CompareOfferReferenceSchema.extend({
  terms: TermsSchema,
  itemSummary: ItemSummarySchema,
  validUntil: UtcDateTimeSchema,
});
export const CompareOffersInputSchema = z
  .object({
    ...commonInput,
    kind: z.literal('COMPARE_OFFERS'),
    inputVersion: CompareInputVersionSchema,
    context: z
      .object({ need: ConfirmedNeedSchema, offers: z.array(CompareOfferInputSchema).max(3) })
      .strict(),
  })
  .strict();
export type CompareOffersInput = z.infer<typeof CompareOffersInputSchema>;
export const AiTaskInputSchema = z.discriminatedUnion('kind', [
  RouteIntentInputSchema,
  ExtractNeedInputSchema,
  RecommendFeeInputSchema,
  ExplainTermsInputSchema,
  CompareOffersInputSchema,
]);
export type AiTaskInput = z.infer<typeof AiTaskInputSchema>;
export const AiTaskResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      taskId: TaskIdSchema,
      kind: z.literal('ROUTE_INTENT'),
      inputVersion: TurnInputVersionSchema,
      result: RouteIntentResultSchema,
    })
    .strict(),
  z
    .object({
      taskId: TaskIdSchema,
      kind: z.literal('EXTRACT_NEED'),
      inputVersion: NeedInputVersionSchema,
      result: ExtractNeedResultSchema,
    })
    .strict(),
  z
    .object({
      taskId: TaskIdSchema,
      kind: z.literal('RECOMMEND_FEE'),
      inputVersion: FeeInputVersionSchema,
      result: RecommendFeeResultSchema,
    })
    .strict(),
  z
    .object({
      taskId: TaskIdSchema,
      kind: z.literal('EXPLAIN_TERMS'),
      inputVersion: NegotiationInputVersionSchema,
      result: ExplainTermsResultSchema,
    })
    .strict(),
  z
    .object({
      taskId: TaskIdSchema,
      kind: z.literal('COMPARE_OFFERS'),
      inputVersion: CompareInputVersionSchema,
      result: CompareOffersResultSchema,
    })
    .strict(),
]);
export type AiTaskResult = z.infer<typeof AiTaskResultSchema>;

/** Directly usable as Responses Structured Outputs json_schema.schema. */
export const AI_RESULT_JSON_SCHEMAS = {
  ROUTE_INTENT: z.toJSONSchema(RouteIntentResultSchema),
  EXTRACT_NEED: z.toJSONSchema(ExtractNeedResultSchema),
  RECOMMEND_FEE: z.toJSONSchema(RecommendFeeResultSchema),
  EXPLAIN_TERMS: z.toJSONSchema(ExplainTermsResultSchema),
  COMPARE_OFFERS: z.toJSONSchema(CompareOffersResultSchema),
} as const;

export interface FeeRecommender {
  recommend(input: RecommendFeeInput): Promise<RecommendFeeResult | null>;
}
export interface NeedExtractor {
  extract(input: ExtractNeedInput): Promise<ExtractNeedResult>;
}
export interface IntentRouter {
  route(input: RouteIntentInput): Promise<RouteIntentResult>;
}
export interface TermsExplainer {
  explain(input: ExplainTermsInput): Promise<ExplainTermsResult>;
}
export interface OfferComparer {
  compare(input: CompareOffersInput): Promise<CompareOffersResult>;
}

/** Internal adapter events, never business mutations or a public SSE payload. */
export type VoiceGatewayEvent =
  | { type: 'session.started'; sessionId: string }
  | {
      type: 'session.input_transcript.delta' | 'session.output_transcript.delta';
      delta: string;
      startMs?: number;
      endMs?: number;
    }
  | { type: 'session.output_audio.delta'; delta: string; startMs: number; endMs: number }
  | { type: 'session.delegation.created'; delegationId: string }
  | { type: 'session.closed' }
  | { type: 'error'; code: string; message: string }
  | { type: 'disconnected' };
export interface VoiceAppendInput {
  type: 'session.commentary.append' | 'session.thinking.append' | 'session.instructions.append';
  eventId: string;
  delegationId: string | null;
  content: string;
}
export interface VoiceGatewaySession {
  /** Exact provider session ID: the API maps it to its opaque voice_ ID. */
  sessionId: string;
  sdpAnswer: string;
  append(input: VoiceAppendInput): Promise<void>;
  close(): Promise<{ confirmed: boolean }>;
}
export interface VoiceGateway {
  /** Resolves only after session.started and sideband readiness. */
  createSession(input: {
    requestId: string;
    actorUserId: string;
    sdpOffer: string;
    onEvent: (event: VoiceGatewayEvent) => void | Promise<void>;
  }): Promise<VoiceGatewaySession>;
}
