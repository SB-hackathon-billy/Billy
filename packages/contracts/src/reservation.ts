// 3번 물품 탐색·예약·대기·앱 알림 계약. 명세: docs/specs/0004-reservations-waitlist-notifications.md
import { z } from 'zod';
import {
  AvailabilitySchema,
  CategorySchema,
  ItemSourceSchema,
  OwnerReasonCodeSchema,
} from './enums.js';
import { ItemSummarySchema } from './entities.js';
import { PaginationQuerySchema } from './http.js';
import {
  checkPeriodShape,
  CountSchema,
  CurrencySchema,
  IdSchema,
  ImageSchema,
  KrwSchema,
  NegotiationIdSchema,
  NotificationIdSchema,
  RequestIdSchema,
  ReservationIdSchema,
  textSchema,
  UtcDateTimeSchema,
  VersionSchema,
  WaitlistEntryIdSchema,
} from './primitives.js';
import { computeFeeOptions } from './utils.js';
import type { ItemSource } from './enums.js';

/** 가용성 사유. 앞의 8개는 기존 `availability()` 사유이고 뒤의 2개가 3번 예약·대기 사유다. */
export const AVAILABILITY_REASON_VALUES = [
  'ITEM_DISABLED',
  'OWN_ITEM',
  'OWNER_INELIGIBLE',
  'DEMO_INELIGIBLE',
  'PLACE_UNAVAILABLE',
  'PERIOD_STARTED',
  'PERIOD_UNAVAILABLE',
  'ACTIVE_HOLD',
  'RESERVED',
  'WAITLIST_PRIORITY',
] as const;
export const AvailabilityReasonSchema = z.enum(AVAILABILITY_REASON_VALUES);
export type AvailabilityReason = z.infer<typeof AvailabilityReasonSchema>;
/** 점유가 풀리면 신청할 수 있게 되는 사유. 이때만 대기 등록을 받는다. */
export const WAITLISTABLE_REASONS: readonly AvailabilityReason[] = [
  'ACTIVE_HOLD',
  'RESERVED',
  'WAITLIST_PRIORITY',
];

/** 바로 신청 금액: 하루 대여료 × 이용일수(24시간 단위 올림). 공공 물품도 같은 고정 요금이다. */
export function reservationFee(
  dailyRateKrw: number,
  startAt: string,
  endAt: string,
  source: ItemSource,
): { billingDays: number; totalFeeKrw: number } {
  const fee = computeFeeOptions(dailyRateKrw, startAt, endAt, source);
  return { billingDays: fee.billingDays, totalFeeKrw: fee.baselineKrw };
}

const periodQuery = (
  value: { startAt?: string | undefined; endAt?: string | undefined },
  ctx: z.RefinementCtx,
) => {
  if (!value.startAt && !value.endAt) return;
  if (!value.startAt || !value.endAt) {
    ctx.addIssue({
      code: 'custom',
      path: [value.startAt ? 'endAt' : 'startAt'],
      message: '시작과 종료를 함께 지정해 주세요.',
    });
    return;
  }
  checkPeriodShape({ startAt: value.startAt, endAt: value.endAt }, ctx);
};

export const CatalogAvailabilitySchema = z
  .object({
    status: AvailabilitySchema,
    reason: AvailabilityReasonSchema.nullable(),
    billingDays: z.number().int().min(1).max(7),
    totalFeeKrw: KrwSchema,
  })
  .strict();
export type CatalogAvailability = z.infer<typeof CatalogAvailabilitySchema>;

export const CatalogItemSchema = z
  .object({
    id: IdSchema,
    title: textSchema(120),
    category: CategorySchema,
    source: ItemSourceSchema,
    image: ImageSchema,
    ownerDisplayName: textSchema(40).nullable(),
    dailyRateKrw: KrwSchema,
    allowedPlaceIds: z.array(IdSchema).min(1).max(3),
    /** 내가 등록한 물품. 신청 대신 관리 화면으로 안내한다. */
    mine: z.boolean(),
    availability: CatalogAvailabilitySchema.nullable(),
  })
  .strict();
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const OCCUPIED_KIND_VALUES = ['RESERVED', 'HELD', 'UNAVAILABLE'] as const;
export const OccupiedPeriodSchema = z
  .object({
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    kind: z.enum(OCCUPIED_KIND_VALUES),
  })
  .strict();
export type OccupiedPeriod = z.infer<typeof OccupiedPeriodSchema>;

export const CatalogItemDetailSchema = CatalogItemSchema.extend({
  description: z.string().max(2_000).nullable(),
  /** 현재 이후 점유 기간(누가 점유했는지는 숨김). */
  occupied: z.array(OccupiedPeriodSchema).max(20),
  waitingCount: CountSchema,
}).strict();
export type CatalogItemDetail = z.infer<typeof CatalogItemDetailSchema>;

export const CatalogQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  category: CategorySchema.optional(),
  source: ItemSourceSchema.optional(),
  startAt: UtcDateTimeSchema.optional(),
  endAt: UtcDateTimeSchema.optional(),
}).superRefine(periodQuery);
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

export const ItemAvailabilityQuerySchema = z
  .object({ startAt: UtcDateTimeSchema, endAt: UtcDateTimeSchema })
  .strict()
  .superRefine(checkPeriodShape);
export const ItemAvailabilitySchema = z
  .object({
    itemId: IdSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    status: AvailabilitySchema,
    reason: AvailabilityReasonSchema.nullable(),
    billingDays: z.number().int().min(1).max(7),
    totalFeeKrw: KrwSchema,
    /** 점유가 풀리면 신청할 수 있어 대기 등록이 가능한지. */
    waitlistable: z.boolean(),
    /** 진행 중인 대기(우선권 포함) 수. */
    waitingCount: CountSchema,
  })
  .strict();
export type ItemAvailability = z.infer<typeof ItemAvailabilitySchema>;

export const RESERVATION_STATUS_VALUES = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const ReservationStatusSchema = z.enum(RESERVATION_STATUS_VALUES);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;
/** 거점 인계·반납(명세 0007). 예약 status는 CONFIRMED로 두고 이 단계만 진행한다. */
export const HANDOVER_STAGE_VALUES = ['READY', 'PICKED_UP', 'RETURNED', 'COMPLETED'] as const;
export const HandoverStageSchema = z.enum(HANDOVER_STAGE_VALUES);
export type HandoverStage = z.infer<typeof HandoverStageSchema>;
/** 거점 관리자 데모 계정(명세 0007). ponytail: 관리자 1명이 모든 장소를 맡는다. 거점별 배정은 TBD. */
export const HUB_MANAGER_ID = 'u_hub';
/** 인계 코드: 혼동 문자(0·O·1·I·L) 없는 8자리. */
export const HANDOVER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const HandoverCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[2-9A-HJKMNP-Z]{8}$/);
export const ReturnComparisonSchema = z
  .object({
    status: z.enum(['DONE', 'FAILED']),
    summary: textSchema(200).nullable(),
    /** AI가 찾은 달라진 부분 후보. 판정이 아니다. */
    differences: z.array(textSchema(120)).max(5),
  })
  .strict();
export type ReturnComparison = z.infer<typeof ReturnComparisonSchema>;
export const INSPECTION_RESULT_VALUES = ['OK', 'DAMAGED'] as const;
export const InspectionResultSchema = z.enum(INSPECTION_RESULT_VALUES);
export const HandoverSchema = z
  .object({
    /** 빌리는 사람과 관리자에게만 내려간다. 빌려준 이웃 화면에서는 빠진다. */
    code: HandoverCodeSchema.optional(),
    stage: HandoverStageSchema,
    pickedUpAt: UtcDateTimeSchema.nullable(),
    pickupPhotoId: IdSchema.nullable(),
    returnedAt: UtcDateTimeSchema.nullable(),
    returnPhotoId: IdSchema.nullable(),
    comparison: ReturnComparisonSchema.nullable(),
    inspection: z
      .object({
        result: InspectionResultSchema,
        note: textSchema(300).nullable(),
        at: UtcDateTimeSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Handover = z.infer<typeof HandoverSchema>;

export const RESERVATION_ORIGIN_VALUES = ['CATALOG', 'REQUEST'] as const;
export const ReservationOriginSchema = z.enum(RESERVATION_ORIGIN_VALUES);
export type ReservationOrigin = z.infer<typeof ReservationOriginSchema>;

export const ReservationSchema = z
  .object({
    id: ReservationIdSchema,
    itemId: IdSchema,
    requesterId: IdSchema,
    /** 공공 물품은 null(센터 모의 응답). */
    ownerId: IdSchema.nullable(),
    source: ItemSourceSchema,
    /** CATALOG: 목록에서 바로 신청, REQUEST: 접수 요청·협상의 결제 미리보기에서 확정. */
    origin: ReservationOriginSchema,
    requestId: RequestIdSchema.nullable(),
    negotiationId: NegotiationIdSchema.nullable(),
    /** 대기 우선권으로 낸 신청이면 그 대기. */
    waitlistEntryId: WaitlistEntryIdSchema.nullable(),
    status: ReservationStatusSchema,
    version: VersionSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    placeId: IdSchema,
    totalFeeKrw: KrwSchema,
    currency: CurrencySchema,
    /** 신청 시점 물품 요약. 물품 수정·비활성화로 기존 예약을 바꾸지 않는다. */
    item: ItemSummarySchema,
    responseDueAt: UtcDateTimeSchema.nullable(),
    closedReason: textSchema(100).nullable(),
    /** 거점 인계·반납 진행(명세 0007). migration 005 이전 행은 null로 읽힌다. */
    handover: HandoverSchema.nullable().default(null),
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type Reservation = z.infer<typeof ReservationSchema>;

export const RESERVATION_ACTOR_VALUES = [
  'REQUESTER',
  'OWNER',
  'PUBLIC_DEMO',
  'SYSTEM',
  'HUB',
] as const;
export const ReservationEventSchema = z
  .object({
    at: UtcDateTimeSchema,
    status: ReservationStatusSchema,
    actor: z.enum(RESERVATION_ACTOR_VALUES),
    reason: textSchema(100).nullable(),
  })
  .strict();
export type ReservationEvent = z.infer<typeof ReservationEventSchema>;

export const RESERVATION_ACTION_VALUES = ['OWNER_APPROVE', 'OWNER_DECLINE', 'CANCEL'] as const;
export const ReservationActionSchema = z.enum(RESERVATION_ACTION_VALUES);
export type ReservationAction = z.infer<typeof ReservationActionSchema>;
export const RESERVATION_ROLE_VALUES = ['REQUESTER', 'OWNER'] as const;
export const ReservationRoleSchema = z.enum(RESERVATION_ROLE_VALUES);

export const ReservationViewSchema = z
  .object({
    reservation: ReservationSchema,
    role: ReservationRoleSchema,
    requesterDisplayName: textSchema(40),
    allowedActions: z.array(ReservationActionSchema),
    history: z.array(ReservationEventSchema),
  })
  .strict();
export type ReservationView = z.infer<typeof ReservationViewSchema>;

export const CreateReservationBodySchema = z
  .object({
    itemId: IdSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    placeId: IdSchema,
    /** 결제 미리보기에서 확정할 때만: 접수 요청과 선택한 협상. */
    requestId: RequestIdSchema.optional(),
    negotiationId: NegotiationIdSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    checkPeriodShape(body, ctx);
    if (!!body.requestId !== !!body.negotiationId)
      ctx.addIssue({
        code: 'custom',
        path: ['negotiationId'],
        message: '요청에서 확정할 때는 요청과 선택한 협상을 함께 보내야 합니다.',
      });
  });
export type CreateReservationBody = z.infer<typeof CreateReservationBodySchema>;

export const RespondReservationBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), expectedVersion: VersionSchema }).strict(),
  z
    .object({
      action: z.literal('DECLINE'),
      expectedVersion: VersionSchema,
      reasonCode: OwnerReasonCodeSchema,
    })
    .strict(),
]);
export type RespondReservationBody = z.infer<typeof RespondReservationBodySchema>;
export const ReservationVersionBodySchema = z.object({ expectedVersion: VersionSchema }).strict();

export const HandoverPhotoBodySchema = z
  .object({ expectedVersion: VersionSchema, photoId: IdSchema })
  .strict();
export type HandoverPhotoBody = z.infer<typeof HandoverPhotoBodySchema>;
export const InspectBodySchema = z
  .object({
    expectedVersion: VersionSchema,
    result: InspectionResultSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.result === 'DAMAGED' && !body.note)
      ctx.addIssue({ code: 'custom', path: ['note'], message: '파손 내용을 적어 주세요.' });
  });
export type InspectBody = z.infer<typeof InspectBodySchema>;
/** 거점 관리자 화면. */
export const HandoverViewSchema = z
  .object({
    reservation: ReservationSchema,
    requesterDisplayName: textSchema(40),
    ownerDisplayName: textSchema(40).nullable(),
    placeLabel: textSchema(100),
  })
  .strict();
export type HandoverView = z.infer<typeof HandoverViewSchema>;

export const ReservationsQuerySchema = PaginationQuerySchema.extend({
  role: ReservationRoleSchema.default('REQUESTER'),
  status: ReservationStatusSchema.optional(),
  requestId: RequestIdSchema.optional(),
});
export type ReservationsQuery = z.infer<typeof ReservationsQuerySchema>;

export const WAITLIST_STATUS_VALUES = [
  'WAITING',
  'NOTIFIED',
  'APPLIED',
  'FULFILLED',
  'EXPIRED',
  'CANCELLED',
] as const;
export const WaitlistStatusSchema = z.enum(WAITLIST_STATUS_VALUES);
export type WaitlistStatus = z.infer<typeof WaitlistStatusSchema>;
/** 아직 끝나지 않은 대기. NOTIFIED·APPLIED는 우선권을 가진다. */
export const WAITLIST_OPEN_STATUSES: readonly WaitlistStatus[] = ['WAITING', 'NOTIFIED', 'APPLIED'];

export const WaitlistEntrySchema = z
  .object({
    id: WaitlistEntryIdSchema,
    itemId: IdSchema,
    userId: IdSchema,
    startAt: UtcDateTimeSchema,
    endAt: UtcDateTimeSchema,
    status: WaitlistStatusSchema,
    version: VersionSchema,
    /** 같은 물품의 진행 중 대기에서 내 순서(1부터). 끝난 대기는 null. */
    position: z.number().int().positive().nullable(),
    /** NOTIFIED일 때 이 시각까지 나만 신청할 수 있다. */
    priorityUntil: UtcDateTimeSchema.nullable(),
    reservationId: ReservationIdSchema.nullable(),
    closedReason: textSchema(100).nullable(),
    item: ItemSummarySchema,
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type WaitlistEntry = z.infer<typeof WaitlistEntrySchema>;

export const CreateWaitlistEntryBodySchema = z
  .object({ itemId: IdSchema, startAt: UtcDateTimeSchema, endAt: UtcDateTimeSchema })
  .strict()
  .superRefine(checkPeriodShape);
export type CreateWaitlistEntryBody = z.infer<typeof CreateWaitlistEntryBodySchema>;
export const WaitlistQuerySchema = PaginationQuerySchema.extend({
  status: WaitlistStatusSchema.optional(),
});

export const NOTIFICATION_TYPE_VALUES = [
  'RESERVATION_REQUESTED',
  'RESERVATION_CONFIRMED',
  'RESERVATION_DECLINED',
  'RESERVATION_CANCELLED',
  'RESERVATION_EXPIRED',
  'WAITLIST_AVAILABLE',
  'WAITLIST_EXPIRED',
  'NEGOTIATION_REQUESTED',
  'OFFER_RECEIVED',
  'INTAKE_FAILED',
  'HANDOVER_PICKED_UP',
  'HANDOVER_RETURNED',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPE_VALUES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z
  .object({
    id: NotificationIdSchema,
    type: NotificationTypeSchema,
    title: textSchema(100),
    body: textSchema(300),
    /** 앱 내부 경로. */
    link: textSchema(300)
      .regex(/^\/[^/]/)
      .nullable(),
    reservationId: ReservationIdSchema.nullable(),
    waitlistEntryId: WaitlistEntryIdSchema.nullable(),
    requestId: RequestIdSchema.nullable(),
    negotiationId: NegotiationIdSchema.nullable(),
    itemId: IdSchema.nullable(),
    createdAt: UtcDateTimeSchema,
    readAt: UtcDateTimeSchema.nullable(),
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z
  .object({
    items: z.array(NotificationSchema),
    nextCursor: textSchema(2_048).nullable(),
    unreadCount: CountSchema,
  })
  .strict();
export type NotificationList = z.infer<typeof NotificationListSchema>;
export const NotificationsQuerySchema = PaginationQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});
export const ReadNotificationsBodySchema = z.union([
  z.object({ notificationIds: z.array(NotificationIdSchema).min(1).max(50) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type ReadNotificationsBody = z.infer<typeof ReadNotificationsBodySchema>;
export const ReadNotificationsDataSchema = z.object({ unreadCount: CountSchema }).strict();
