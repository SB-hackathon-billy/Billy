import { z } from 'zod';
import { LIMITS } from './enums.js';

export const textSchema = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const IdSchema = textSchema(128);
export const RequestIdSchema = IdSchema.regex(/^req_[A-Za-z0-9_-]+$/);
export const NegotiationIdSchema = IdSchema.regex(/^neg_[A-Za-z0-9_-]+$/);
export const OfferIdSchema = IdSchema.regex(/^offer_[A-Za-z0-9_-]+$/);
export const QuoteIdSchema = IdSchema.regex(/^quote_[A-Za-z0-9_-]+$/);
export const TaskIdSchema = IdSchema.regex(/^task_[A-Za-z0-9_-]+$/);
export const VoiceSessionIdSchema = IdSchema.regex(/^voice_[A-Za-z0-9_-]+$/);
// 3번 예약·대기·알림 ID (명세 0004). SSE 이벤트와 예약 계약이 함께 쓴다.
export const ReservationIdSchema = IdSchema.regex(/^rsv_[A-Za-z0-9_-]+$/);
export const WaitlistEntryIdSchema = IdSchema.regex(/^wl_[A-Za-z0-9_-]+$/);
export const NotificationIdSchema = IdSchema.regex(/^ntf_[A-Za-z0-9_-]+$/);
export const UtcDateTimeSchema = z.iso.datetime({ offset: false });
export const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const KrwSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const CurrencySchema = z.literal('KRW');
export const EventCursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(30);
export const ImageSchema = z
  .object({
    url: textSchema(2_048),
    alt: textSchema(300),
    isIllustration: z.boolean(),
  })
  .strict();
export type Image = z.infer<typeof ImageSchema>;

/** Static period rules; checking against the server clock is validatePeriod's job. */
export function checkPeriodShape(
  value: { startAt: string; endAt: string },
  ctx: z.RefinementCtx,
): void {
  const start = Date.parse(value.startAt);
  const end = Date.parse(value.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (start % LIMITS.periodStepMs !== 0 || end % LIMITS.periodStepMs !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['startAt'],
      message: '시작과 종료는 30분 단위여야 합니다.',
    });
  }
  if (end - start < LIMITS.minPeriodMs || end - start > LIMITS.maxPeriodMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['endAt'],
      message: '대여 기간은 1시간 이상 7일 이하여야 합니다.',
    });
  }
}
export const PeriodSchema = z
  .object({ startAt: UtcDateTimeSchema, endAt: UtcDateTimeSchema })
  .strict()
  .superRefine(checkPeriodShape);
export type Period = z.infer<typeof PeriodSchema>;
/** Unavailable blocks are not rental periods and can exceed 7 days. */
export const UnavailableIntervalSchema = z
  .object({ startAt: UtcDateTimeSchema, endAt: UtcDateTimeSchema })
  .strict()
  .refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), {
    message: '종료는 시작 이후여야 합니다.',
  });
