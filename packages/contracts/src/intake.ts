// 1번 접수: 사람이 승인한 통화 신청서로 예약 신청 도구를 실행한 이력.
// 명세: docs/specs/0003-voice-call-reservation.md
import { z } from 'zod';
import { ConfirmedNeedSchema } from './entities.js';
import { validatePeriod } from './utils.js';
import {
  CountSchema,
  IdSchema,
  NegotiationIdSchema,
  RequestIdSchema,
  TaskIdSchema,
  UtcDateTimeSchema,
  VersionSchema,
  VoiceSessionIdSchema,
} from './primitives.js';

/** 에이전트가 사람의 최종 승인 뒤에만 서버로 실행하는 유일한 예약 도구 이름. */
export const RESERVATION_TOOL_NAME = 'request_reservation' as const;

export const INTAKE_APPROVAL_STATUS_VALUES = [
  'QUEUED',
  'SEARCHING',
  'SUBMITTED',
  'NO_MATCH',
  'CLOSED',
  'RETRYING',
] as const;
export const IntakeApprovalStatusSchema = z.enum(INTAKE_APPROVAL_STATUS_VALUES);
export type IntakeApprovalStatus = z.infer<typeof IntakeApprovalStatusSchema>;
export const INTAKE_APPROVAL_TERMINAL: readonly IntakeApprovalStatus[] = [
  'SUBMITTED',
  'NO_MATCH',
  'CLOSED',
];

export const IntakeApprovalIdSchema = IdSchema.regex(/^iap_[A-Za-z0-9_-]+$/);
export const IntakeApprovalSchema = z
  .object({
    id: IntakeApprovalIdSchema,
    requestId: RequestIdSchema,
    requesterId: IdSchema,
    voiceSessionId: VoiceSessionIdSchema.nullable(),
    extractionTaskId: TaskIdSchema,
    tool: z.literal(RESERVATION_TOOL_NAME),
    status: IntakeApprovalStatusSchema,
    /** 실패 전 마지막으로 성공한 단계. 재시도는 이 단계부터 이어간다. */
    step: z.enum(['CONFIRM', 'SUBMIT', 'DONE']),
    need: ConfirmedNeedSchema,
    /** Consecutive failed tool calls; drives the background backoff. */
    attempts: CountSchema,
    lastErrorCode: z.string().max(64).nullable(),
    nextAttemptAt: UtcDateTimeSchema.nullable(),
    negotiationIds: z.array(NegotiationIdSchema).max(3),
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type IntakeApproval = z.infer<typeof IntakeApprovalSchema>;

export const CreateIntakeApprovalBodySchema = z
  .object({
    requestId: RequestIdSchema,
    extractionTaskId: TaskIdSchema,
    expectedRequestVersion: VersionSchema,
    voiceSessionId: VoiceSessionIdSchema.optional(),
  })
  .strict();
export type CreateIntakeApprovalBody = z.infer<typeof CreateIntakeApprovalBodySchema>;

/**
 * Same rule as the voice server's completion guard (apps/api/src/voice/guards.ts): budget is optional,
 * a pending question or an invalid period keeps the checklist open.
 */
export function isNeedCollectionComplete(
  result: {
    proposedNeed: unknown;
    missingFields: readonly string[];
    clarificationQuestion: string | null;
  },
  serverNow: Date | string | number,
): boolean {
  if (result.missingFields.length || result.clarificationQuestion !== null) return false;
  const parsed = ConfirmedNeedSchema.safeParse(result.proposedNeed);
  return parsed.success && validatePeriod(parsed.data.startAt, parsed.data.endAt, serverNow).valid;
}
