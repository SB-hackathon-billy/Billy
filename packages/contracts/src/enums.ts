import { z } from 'zod';

export const CONTRACT_VERSION = '0.3.0' as const;
export const POLICY_VERSION = 'demo-fee-v1' as const;

export const REQUEST_STATUS_VALUES = [
  'DRAFT',
  'SEARCHING',
  'MATCHES_READY',
  'COLLECTING_OFFERS',
  'PAYMENT_PREVIEW_READY',
  'NO_MATCH',
  'FAILED',
  'NO_OFFERS',
  'CANCELLED',
  'EXPIRED',
] as const;
export const RequestStatusSchema = z.enum(REQUEST_STATUS_VALUES);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const NEGOTIATION_STATUS_VALUES = [
  'AWAITING_OWNER',
  'PENDING_PUBLIC',
  'OFFERED',
  'SELECTED',
  'DECLINED',
  'SUPERSEDED',
  'WITHDRAWN',
  'EXPIRED',
  'UNAVAILABLE',
] as const;
export const NegotiationStatusSchema = z.enum(NEGOTIATION_STATUS_VALUES);
export type NegotiationStatus = z.infer<typeof NegotiationStatusSchema>;

export const ALLOWED_ACTION_VALUES = [
  'EDIT_DRAFT',
  'SEARCH',
  'SUBMIT_CANDIDATES',
  'OWNER_APPROVE',
  'OWNER_DECLINE',
  'OWNER_COUNTER',
  'REQUESTER_COUNTER',
  'WITHDRAW_BRANCH',
  'SELECT_OFFER',
  'CANCEL_REQUEST',
  'OPEN_PAYMENT_PREVIEW',
] as const;
export const AllowedActionSchema = z.enum(ALLOWED_ACTION_VALUES);
export type AllowedAction = z.infer<typeof AllowedActionSchema>;

export const CATEGORY_VALUES = ['CLEANING', 'TOOLS', 'TRAVEL', 'HOBBY'] as const;
export const CategorySchema = z.enum(CATEGORY_VALUES);
export type Category = z.infer<typeof CategorySchema>;

export const ITEM_SOURCE_VALUES = ['PUBLIC', 'RESIDENT'] as const;
export const ItemSourceSchema = z.enum(ITEM_SOURCE_VALUES);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

export const AVAILABILITY_VALUES = ['AVAILABLE', 'UNAVAILABLE'] as const;
export const AvailabilitySchema = z.enum(AVAILABILITY_VALUES);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const PUBLIC_SCENARIO_VALUES = ['APPROVE', 'DECLINE'] as const;
export const PublicScenarioSchema = z.enum(PUBLIC_SCENARIO_VALUES);
export type PublicScenario = z.infer<typeof PublicScenarioSchema>;

export const DEMO_SCENARIO_VALUES = ['default', 'expiry-fast', 'ineligible'] as const;
export const DemoScenarioSchema = z.enum(DEMO_SCENARIO_VALUES);
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const DEMO_HOLD_STATUS_VALUES = ['ACTIVE', 'EXPIRED', 'RELEASED'] as const;
export const DemoHoldStatusSchema = z.enum(DEMO_HOLD_STATUS_VALUES);
export type DemoHoldStatus = z.infer<typeof DemoHoldStatusSchema>;

export const CHANGED_FIELD_VALUES = ['START_AT', 'END_AT', 'PLACE', 'TOTAL_FEE'] as const;
export const ChangedFieldSchema = z.enum(CHANGED_FIELD_VALUES);
export type ChangedField = z.infer<typeof ChangedFieldSchema>;

export const OWNER_ACTION_VALUES = ['APPROVE', 'DECLINE', 'COUNTER'] as const;
export const OwnerActionSchema = z.enum(OWNER_ACTION_VALUES);
export type OwnerAction = z.infer<typeof OwnerActionSchema>;

export const OWNER_REASON_CODE_VALUES = [
  'SCHEDULE_ADJUSTMENT',
  'PLACE_ADJUSTMENT',
  'PRICE_ADJUSTMENT',
  'UNAVAILABLE',
  'OTHER_CONDITION',
] as const;
export const OwnerReasonCodeSchema = z.enum(OWNER_REASON_CODE_VALUES);
export type OwnerReasonCode = z.infer<typeof OwnerReasonCodeSchema>;

export const FEE_OPTION_ID_VALUES = ['LOWER', 'STANDARD', 'UPPER'] as const;
export const FeeOptionIdSchema = z.enum(FEE_OPTION_ID_VALUES);
export type FeeOptionId = z.infer<typeof FeeOptionIdSchema>;

export const RECOMMENDATION_SOURCE_VALUES = ['AI', 'BASELINE', 'PUBLIC_FIXED'] as const;
export const RecommendationSourceSchema = z.enum(RECOMMENDATION_SOURCE_VALUES);
export type RecommendationSource = z.infer<typeof RecommendationSourceSchema>;

export const PRICING_REASON_CODE_VALUES = [
  'BASELINE',
  'FLEXIBLE_HANDOFF',
  'REGISTERED_EXTRA_EFFORT',
] as const;
export const PricingReasonCodeSchema = z.enum(PRICING_REASON_CODE_VALUES);
export type PricingReasonCode = z.infer<typeof PricingReasonCodeSchema>;

export const ENDORSED_BY_VALUES = ['OWNER', 'PUBLIC_DEMO'] as const;
export const EndorsedBySchema = z.enum(ENDORSED_BY_VALUES);
export type EndorsedBy = z.infer<typeof EndorsedBySchema>;

export const AGENT_TASK_KIND_VALUES = [
  'ROUTE_INTENT',
  'EXTRACT_NEED',
  'SEARCH',
  'PUBLIC_SUBMIT',
  'RECOMMEND_FEE',
  'EXPLAIN_TERMS',
  'COMPARE_OFFERS',
] as const;
export const AgentTaskKindSchema = z.enum(AGENT_TASK_KIND_VALUES);
export type AgentTaskKind = z.infer<typeof AgentTaskKindSchema>;

export const AI_TASK_KIND_VALUES = [
  'ROUTE_INTENT',
  'EXTRACT_NEED',
  'RECOMMEND_FEE',
  'EXPLAIN_TERMS',
  'COMPARE_OFFERS',
] as const;
export const AiTaskKindSchema = z.enum(AI_TASK_KIND_VALUES);
export type AiTaskKind = z.infer<typeof AiTaskKindSchema>;

export const AGENT_TASK_STATUS_VALUES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export const AgentTaskStatusSchema = z.enum(AGENT_TASK_STATUS_VALUES);
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

export const VOICE_STATUS_VALUES = [
  'IDLE',
  'CONNECTING',
  'LISTENING',
  'SPEAKING',
  'RECONNECT_REQUIRED',
  'CLOSED',
  'ERROR',
] as const;
export const VoiceStatusSchema = z.enum(VOICE_STATUS_VALUES);
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const AGENT_ACTIVITY_VALUES = [
  'IDLE',
  'CLARIFYING',
  'SEARCHING',
  'PRICING',
  'SUMMARIZING',
  'WAITING_FOR_OWNER',
  'WAITING_FOR_REQUESTER',
  'FAILED',
] as const;
export const AgentActivitySchema = z.enum(AGENT_ACTIVITY_VALUES);
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const SSE_EVENT_TYPE_VALUES = [
  'request.updated',
  'negotiation.created',
  'negotiation.updated',
  'agent.task.updated',
  'demo_hold.expired',
  'session.revoked',
  'sync.required',
  'heartbeat',
] as const;
export const SseEventTypeSchema = z.enum(SSE_EVENT_TYPE_VALUES);
export type SseEventType = z.infer<typeof SseEventTypeSchema>;

export const CENTER_CONTENT_TYPE_VALUES = [
  'ABOUT',
  'PROGRAM',
  'CLUB',
  'SPACE',
  'NOTICE',
  'PRESS',
  'GALLERY',
  'GUIDE',
] as const;
export const CenterContentTypeSchema = z.enum(CENTER_CONTENT_TYPE_VALUES);
export type CenterContentType = z.infer<typeof CenterContentTypeSchema>;

export const INTENT_VALUES = [
  'RENTAL_REQUEST',
  'CHANGE_CONDITIONS',
  'STATUS_QUERY',
  'CENTER_INFO',
  'UNCLEAR',
] as const;
export const IntentSchema = z.enum(INTENT_VALUES);
export type Intent = z.infer<typeof IntentSchema>;

export const NEED_FIELD_VALUES = [
  'category',
  'queryText',
  'startAt',
  'endAt',
  'preferredPlaceIds',
  'maxBudgetKrw',
] as const;
export const NeedFieldSchema = z.enum(NEED_FIELD_VALUES);
export type NeedField = z.infer<typeof NeedFieldSchema>;

export const INBOX_ROLE_VALUES = ['REQUESTER', 'OWNER'] as const;
export const InboxRoleSchema = z.enum(INBOX_ROLE_VALUES);
export type InboxRole = z.infer<typeof InboxRoleSchema>;

export const ERROR_HTTP_STATUS = {
  BAD_REQUEST: 400,
  SESSION_EXPIRED: 401,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  ALREADY_SELECTED: 409,
  AVAILABILITY_CONFLICT: 409,
  QUOTE_EXPIRED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_EXPIRED: 410,
  OFFER_EXPIRED: 410,
  VALIDATION_ERROR: 422,
  UNKNOWN_DEMO_ID: 422,
  PRICE_OUT_OF_RANGE: 422,
  CHANGE_LIMIT_REACHED: 422,
  NO_CHANGES: 422,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  TEMPORARILY_UNAVAILABLE: 503,
} as const;
export const ErrorCodeSchema = z.enum(
  Object.keys(ERROR_HTTP_STATUS) as [
    keyof typeof ERROR_HTTP_STATUS,
    ...(keyof typeof ERROR_HTTP_STATUS)[],
  ],
);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ACTIVE_NEGOTIATION_STATUSES = ['PENDING_PUBLIC', 'AWAITING_OWNER', 'OFFERED'] as const;
export const TERMINAL_REQUEST_STATUSES = [
  'PAYMENT_PREVIEW_READY',
  'NO_MATCH',
  'FAILED',
  'NO_OFFERS',
  'CANCELLED',
  'EXPIRED',
] as const;
export const REQUEST_TRANSITIONS = {
  DRAFT: ['SEARCHING', 'CANCELLED', 'EXPIRED'],
  SEARCHING: ['MATCHES_READY', 'NO_MATCH', 'FAILED', 'CANCELLED', 'EXPIRED'],
  MATCHES_READY: ['COLLECTING_OFFERS', 'DRAFT', 'CANCELLED', 'EXPIRED'],
  COLLECTING_OFFERS: ['PAYMENT_PREVIEW_READY', 'NO_OFFERS', 'CANCELLED', 'EXPIRED'],
  PAYMENT_PREVIEW_READY: [],
  NO_MATCH: [],
  FAILED: [],
  NO_OFFERS: [],
  CANCELLED: [],
  EXPIRED: [],
} as const satisfies Record<RequestStatus, readonly RequestStatus[]>;

export const TIMING = {
  responseMs: 24 * 60 * 60 * 1000,
  offerMs: 30 * 60 * 1000,
  holdMs: 10 * 60 * 1000,
  rootMs: 24 * 60 * 60 * 1000,
  quoteMs: 5 * 60 * 1000,
} as const;
export const LIMITS = {
  maxCandidates: 3,
  maxChanges: 3,
  minPeriodMs: 60 * 60 * 1000,
  maxPeriodMs: 7 * 24 * 60 * 60 * 1000,
  periodStepMs: 30 * 60 * 1000,
  sessionMs: 8 * 60 * 60 * 1000,
  idempotencyMs: 24 * 60 * 60 * 1000,
  eventRetentionMs: 24 * 60 * 60 * 1000,
  heartbeatMs: 15_000,
  heartbeatTimeoutMs: 30_000,
  pollingMs: 5_000,
  feeRecommendationMs: 8_000,
  voiceMaxMs: 10 * 60 * 1000,
  voiceIdleMs: 60_000,
  voiceCloseMs: 15_000,
  maxTaskAttempts: 3,
  taskRetryMs: [1_000, 4_000],
} as const;
