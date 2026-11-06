// 3번 탐색·대여 관리 도메인: 예약 원장, 중복 점유 방지, 대기 1순위 우선권, 앱 알림.
// 명세: docs/specs/0004-reservations-waitlist-notifications.md
//
// 잠금 순서(교착 방지): 접수 요청 → 협상 → 물품(items) → 예약 → 대기. 예약·대기 행은 항상
// 해당 물품 행을 잠근 뒤에 잠근다. 최종 보증은 DB 배타 제약(확정 예약 기간 겹침 금지)이다.
import { randomBytes } from 'node:crypto';
import {
  HANDOVER_CODE_ALPHABET,
  HUB_MANAGER_ID,
  NotificationSchema,
  ReservationSchema,
  WaitlistEntrySchema,
  WAITLISTABLE_REASONS,
  WAITLIST_OPEN_STATUSES,
  formatSeoulDateTime,
  matchesItem,
  reservationFee,
  validatePeriod,
  type AvailabilityReason,
  type CatalogItem,
  type CatalogItemDetail,
  type CatalogQuery,
  type CreateReservationBody,
  type CreateWaitlistEntryBody,
  type Handover,
  type HandoverPhotoBody,
  type HandoverView,
  type InspectBody,
  type Item,
  type ItemAvailability,
  type Negotiation,
  type Notification,
  type NotificationType,
  type OccupiedPeriod,
  type Reservation,
  type ReservationAction,
  type ReservationEvent,
  type ReservationView,
  type RespondReservationBody,
  type ReturnComparison,
  type WaitlistEntry,
  type WaitlistStatus,
} from '@sb/contracts';
import type { Commands } from './commands.js';
import type { Database } from './database.js';
import type { Unit } from './unit.js';
import { all, fail, id, read } from './storage.js';

/** 대기 1순위 우선권 시간. `expiry-fast` 시연은 30초. */
export const WAITLIST_PRIORITY_MS = 30 * 60 * 1000;
export const WAITLIST_PRIORITY_FAST_MS = 30 * 1000;
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN = WAITLIST_OPEN_STATUSES as readonly string[];

const period = (startAt: string, endAt: string) =>
  `${formatSeoulDateTime(startAt)} ~ ${formatSeoulDateTime(endAt)}`;
const overlaps = (a: { startAt: string; endAt: string }, b: { startAt: string; endAt: string }) =>
  Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);

/**
 * 저장 직전 내부 검증. ZodError는 API mutation 래퍼가 422 응답으로 바꿔 트랜잭션을 커밋하므로
 * 일반 오류로 던져 전체를 되돌린다(리뷰 지적: 부분 커밋 방지).
 */
function checked<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${what} record`);
  return parsed.data;
}

export async function priorityMs(u: Unit): Promise<number> {
  return (await u.config()).name === 'expiry-fast'
    ? WAITLIST_PRIORITY_FAST_MS
    : WAITLIST_PRIORITY_MS;
}

// ---------------------------------------------------------------------------------------------
// 점유 검사: 공용 availability()가 기존 사유 뒤에 호출한다.

/** 확정 예약 겹침 → RESERVED, 다른 사용자의 대기 우선권 겹침 → WAITLIST_PRIORITY. */
export async function occupancyReason(
  u: Unit,
  itemId: string,
  requesterId: string,
  startAt: string,
  endAt: string,
): Promise<'RESERVED' | 'WAITLIST_PRIORITY' | null> {
  const reserved = await u.c.query(
    "SELECT 1 FROM reservations WHERE item_id=$1 AND status='CONFIRMED' AND tstzrange(start_at,end_at,'[)') && tstzrange($2,$3,'[)') LIMIT 1",
    [itemId, startAt, endAt],
  );
  if (reserved.rowCount) return 'RESERVED';
  const priority = await u.c.query(
    "SELECT 1 FROM waitlist_entries WHERE item_id=$1 AND user_id<>$2 AND ((status='NOTIFIED' AND priority_until>$5) OR status='APPLIED') AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') LIMIT 1",
    [itemId, requesterId, startAt, endAt, u.iso],
  );
  return priority.rowCount ? 'WAITLIST_PRIORITY' : null;
}

// ---------------------------------------------------------------------------------------------
// 앱 알림

type NotificationInput = Pick<Notification, 'type' | 'title' | 'body'> &
  Partial<Omit<Notification, 'id' | 'type' | 'title' | 'body' | 'createdAt' | 'readAt'>>;

/** 알림 행을 쓰고 SSE `notification.created`를 보낸다. 같은 트랜잭션의 결과와 함께 커밋된다. */
export async function notify(u: Unit, userId: string, input: NotificationInput) {
  const notification: Notification = checked(
    NotificationSchema,
    {
      id: id('ntf'),
      link: null,
      reservationId: null,
      waitlistEntryId: null,
      requestId: null,
      negotiationId: null,
      itemId: null,
      ...input,
      title: input.title.slice(0, 100),
      body: input.body.slice(0, 300),
      createdAt: u.iso,
      readAt: null,
    },
    'notification',
  );
  await u.c.query('INSERT INTO notifications(id,user_id,data,created_at) VALUES($1,$2,$3,$4)', [
    notification.id,
    userId,
    notification,
    u.iso,
  ]);
  u.event(userId, {
    type: 'notification.created',
    notificationId: notification.id,
    reason: input.type,
  });
  return notification;
}

/** 협상 흐름 알림(공용 명령에서 호출). 상태 전이는 바꾸지 않는다. */
export async function notifyNegotiation(
  u: Unit,
  type: Extract<NotificationType, 'NEGOTIATION_REQUESTED' | 'OFFER_RECEIVED'>,
  requestId: string,
  requesterId: string,
  n: Negotiation,
) {
  const item = await u.item(n.itemId);
  if (type === 'NEGOTIATION_REQUESTED') {
    if (!n.ownerId) return;
    const requester = await u.user(requesterId);
    await notify(u, n.ownerId, {
      type,
      title: '새 대여 요청이 왔어요',
      body: `${requester.displayName}님 · ${item.title} · ${period(n.terms.startAt, n.terms.endAt)}. 요청함에서 조건을 확인하고 응답해 주세요.`,
      link: '/inbox?role=OWNER',
      requestId,
      negotiationId: n.id,
      itemId: item.id,
    });
  } else
    await notify(u, requesterId, {
      type,
      title: '대여 조건이 도착했어요',
      body: `${item.title} · ${period(n.terms.startAt, n.terms.endAt)}. 도착한 조건을 비교하고 선택해 주세요.`,
      link: `/requests/${requestId}`,
      requestId,
      negotiationId: n.id,
      itemId: item.id,
    });
}

export async function listNotifications(
  u: Unit,
  userId: string,
  unreadOnly: boolean,
): Promise<{ items: (Notification & { seq: string })[]; unreadCount: number }> {
  const rows = await u.c.query(
    `SELECT data, read_at, seq::text FROM notifications WHERE user_id=$1 ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY seq DESC LIMIT 500`,
    [userId],
  );
  const unread = await u.c.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
    [userId],
  );
  return {
    items: rows.rows.map((row) => ({
      ...(row.data as Notification),
      readAt: row.read_at ? (row.read_at as Date).toISOString() : null,
      seq: row.seq as string,
    })),
    unreadCount: unread.rows[0].n as number,
  };
}

export async function readNotifications(u: Unit, userId: string, ids: string[] | 'ALL') {
  if (ids === 'ALL')
    await u.c.query('UPDATE notifications SET read_at=$2 WHERE user_id=$1 AND read_at IS NULL', [
      userId,
      u.iso,
    ]);
  else
    await u.c.query(
      'UPDATE notifications SET read_at=$3 WHERE user_id=$1 AND id=ANY($2::text[]) AND read_at IS NULL',
      [userId, ids, u.iso],
    );
  const unread = await u.c.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
    [userId],
  );
  return { unreadCount: unread.rows[0].n as number };
}

// ---------------------------------------------------------------------------------------------
// 예약 저장·이력·화면

async function insertReservation(u: Unit, r: Reservation) {
  checked(ReservationSchema, r, 'reservation');
  await u.c.query(
    'INSERT INTO reservations(id,data,item_id,requester_id,owner_id,request_id,status,start_at,end_at,response_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      r.id,
      r,
      r.itemId,
      r.requesterId,
      r.ownerId,
      r.requestId,
      r.status,
      r.startAt,
      r.endAt,
      r.responseDueAt,
    ],
  );
}

async function updateReservation(u: Unit, r: Reservation) {
  r.version++;
  r.updatedAt = u.iso;
  checked(ReservationSchema, r, 'reservation');
  await u.c.query('UPDATE reservations SET data=$2,status=$3,response_due_at=$4 WHERE id=$1', [
    r.id,
    r,
    r.status,
    r.responseDueAt,
  ]);
}

async function recordHistory(
  u: Unit,
  r: Reservation,
  actor: ReservationEvent['actor'],
  reason: string | null,
) {
  const event: ReservationEvent = { at: u.iso, status: r.status, actor, reason };
  await u.c.query(
    'INSERT INTO reservation_events(reservation_id,seq,data) SELECT $1, coalesce(max(seq),0)+1, $2 FROM reservation_events WHERE reservation_id=$1',
    [r.id, event],
  );
}

function reservationEvents(u: Unit, r: Reservation, reason: string) {
  for (const userId of new Set([r.requesterId, ...(r.ownerId ? [r.ownerId] : [])]))
    u.event(userId, {
      type: 'reservation.updated',
      reservationId: r.id,
      ...(r.requestId && userId === r.requesterId ? { requestId: r.requestId } : {}),
      reason,
    });
}

async function lockReservation(u: Unit, reservationId: string): Promise<Reservation> {
  const row = await u.c.query('SELECT data FROM reservations WHERE id=$1 FOR UPDATE', [
    reservationId,
  ]);
  u.refreshClock();
  return (row.rows[0]?.data as Reservation | undefined) ?? fail('NOT_FOUND');
}

function allowedActions(u: Unit, r: Reservation, role: 'REQUESTER' | 'OWNER') {
  const actions: ReservationAction[] = [];
  const now = u.now.getTime();
  if (role === 'OWNER') {
    if (
      r.status === 'PENDING' &&
      r.source === 'RESIDENT' &&
      (!r.responseDueAt || Date.parse(r.responseDueAt) > now)
    )
      actions.push('OWNER_APPROVE', 'OWNER_DECLINE');
  } else if (
    r.status === 'PENDING' ||
    (r.status === 'CONFIRMED' && Date.parse(r.startAt) > now && notHandedOver(r))
  )
    actions.push('CANCEL');
  return actions;
}

export async function reservationView(
  u: Unit,
  actor: string,
  r: Reservation,
  withHistory = false,
): Promise<ReservationView> {
  const role = r.requesterId === actor ? 'REQUESTER' : 'OWNER';
  const history = withHistory
    ? (
        await u.c.query(
          'SELECT data FROM reservation_events WHERE reservation_id=$1 ORDER BY seq',
          [r.id],
        )
      ).rows.map((row) => row.data as ReservationEvent)
    : [];
  const handover = r.handover ?? null;
  return {
    reservation: {
      ...r,
      handover: handover && role === 'OWNER' ? withoutCode(handover) : handover,
    },
    role,
    requesterDisplayName: (await u.user(r.requesterId)).displayName,
    allowedActions: allowedActions(u, r, role),
    history,
  };
}

export async function getReservation(u: Unit, actor: string, reservationId: string) {
  const r = await read<Reservation>(u.c, 'reservations', reservationId);
  if (!r || (r.requesterId !== actor && r.ownerId !== actor)) fail('NOT_FOUND');
  return reservationView(u, actor, r, true);
}

export async function listReservations(
  u: Unit,
  actor: string,
  query: {
    role: 'REQUESTER' | 'OWNER';
    status?: string | undefined;
    requestId?: string | undefined;
  },
) {
  const rows = await all<Reservation>(
    u.c,
    'reservations',
    `WHERE ${query.role === 'OWNER' ? 'owner_id' : 'requester_id'}=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR request_id=$3)`,
    [actor, query.status ?? null, query.requestId ?? null],
  );
  const views: ReservationView[] = [];
  for (const r of rows) views.push(await reservationView(u, actor, r));
  return views;
}

// ---------------------------------------------------------------------------------------------
// 예약 명령

async function placeLabel(u: Unit, placeId: string) {
  return (await u.places()).find((p) => p.id === placeId)?.label ?? placeId;
}

/** 확정 직후: 같은 기간 다른 신청 정리, 요청자 대기 충족, 알림. */
async function afterConfirmed(
  u: Commands,
  r: Reservation,
  by: ReservationEvent['actor'],
  reason: string,
) {
  await recordHistory(u, r, by, reason);
  reservationEvents(u, r, reason);
  const others = await all<Reservation>(
    u.c,
    'reservations',
    "WHERE item_id=$1 AND status='PENDING' AND id<>$2 AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') ORDER BY id FOR UPDATE",
    [r.itemId, r.id, r.startAt, r.endAt],
  );
  for (const other of others) {
    other.status = 'DECLINED';
    other.closedReason = 'PERIOD_TAKEN';
    other.responseDueAt = null;
    await updateReservation(u, other);
    await recordHistory(u, other, 'SYSTEM', 'PERIOD_TAKEN');
    reservationEvents(u, other, 'PERIOD_TAKEN');
    await closeLinkedWaitlist(u, other, 'RESERVATION_DECLINED');
    await notify(u, other.requesterId, {
      type: 'RESERVATION_DECLINED',
      title: '같은 기간에 다른 예약이 확정됐어요',
      body: `${other.item.title} · ${period(other.startAt, other.endAt)}. 대기를 신청하면 자리가 날 때 먼저 알려드려요.`,
      link: `/catalog/${other.itemId}`,
      reservationId: other.id,
      itemId: other.itemId,
    });
  }
  const fulfilled = await u.c.query(
    `SELECT data FROM waitlist_entries WHERE item_id=$1 AND user_id=$2 AND status IN ('WAITING','NOTIFIED','APPLIED') AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') ORDER BY seq FOR UPDATE`,
    [r.itemId, r.requesterId, r.startAt, r.endAt],
  );
  for (const row of fulfilled.rows) {
    const entry = row.data as StoredWaitlistEntry;
    await saveWaitlist(u, {
      ...entry,
      status: 'FULFILLED',
      reservationId: r.id,
      priorityUntil: null,
    });
  }
  const label = await placeLabel(u, r.placeId);
  if (by === 'REQUESTER') {
    if (r.ownerId)
      await notify(u, r.ownerId, {
        type: 'RESERVATION_CONFIRMED',
        title: '예약이 확정됐어요',
        body: `${(await u.user(r.requesterId)).displayName}님 · ${r.item.title} · ${period(r.startAt, r.endAt)} · ${label}`,
        link: `/reservations/${r.id}`,
        reservationId: r.id,
        itemId: r.itemId,
      });
  } else
    await notify(u, r.requesterId, {
      type: 'RESERVATION_CONFIRMED',
      title: '예약이 확정됐어요',
      body: `${r.item.title} · ${period(r.startAt, r.endAt)} · ${label}`,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: r.itemId,
    });
}

/** 바로 신청(PENDING) 또는 결제 미리보기 확정(CONFIRMED). */
export async function createReservation(
  u: Commands,
  actor: string,
  body: CreateReservationBody,
): Promise<ReservationView> {
  return body.requestId && body.negotiationId
    ? confirmFromPreview(u, actor, body, body.requestId, body.negotiationId)
    : requestReservation(u, actor, body);
}

async function requestReservation(u: Commands, actor: string, body: CreateReservationBody) {
  if (!validatePeriod(body.startAt, body.endAt, u.now).valid)
    fail('VALIDATION_ERROR', { fields: ['startAt'] });
  if (!(await read<Item>(u.c, 'items', body.itemId))) fail('NOT_FOUND');
  await u.lockItems([body.itemId]);
  const item = await u.item(body.itemId);
  if (!item.enabled) fail('NOT_FOUND');
  if (!item.allowedPlaceIds.includes(body.placeId))
    fail('VALIDATION_ERROR', { fields: ['placeId'] });
  const duplicate = await u.c.query(
    "SELECT 1 FROM reservations WHERE item_id=$1 AND requester_id=$2 AND status IN ('PENDING','CONFIRMED') AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') LIMIT 1",
    [item.id, actor, body.startAt, body.endAt],
  );
  if (duplicate.rowCount) fail('DUPLICATE_RESERVATION');
  const reason = (await u.availability(item, actor, body)) as AvailabilityReason | null;
  if (reason)
    fail('AVAILABILITY_CONFLICT', { reason, waitlistable: WAITLISTABLE_REASONS.includes(reason) });
  // 우선권을 가진 본인 대기가 있으면 신청과 연결해, 결정될 때까지 우선권을 유지한다.
  const priority = (
    await u.c.query(
      "SELECT data FROM waitlist_entries WHERE item_id=$1 AND user_id=$2 AND status='NOTIFIED' AND priority_until>$5 AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') ORDER BY seq LIMIT 1 FOR UPDATE",
      [item.id, actor, body.startAt, body.endAt, u.iso],
    )
  ).rows[0]?.data as StoredWaitlistEntry | undefined;
  const { timing } = await u.config();
  const fee = reservationFee(item.dailyRateKrw, body.startAt, body.endAt, item.source);
  const r: Reservation = {
    id: id('rsv'),
    itemId: item.id,
    requesterId: actor,
    ownerId: item.ownerId,
    source: item.source,
    origin: 'CATALOG',
    requestId: null,
    negotiationId: null,
    waitlistEntryId: priority?.id ?? null,
    status: 'PENDING',
    version: 1,
    startAt: body.startAt,
    endAt: body.endAt,
    placeId: body.placeId,
    totalFeeKrw: fee.totalFeeKrw,
    currency: 'KRW',
    item: await u.itemSummary(item),
    responseDueAt: new Date(
      Math.min(u.now.getTime() + timing.responseMs, Date.parse(body.startAt)),
    ).toISOString(),
    closedReason: null,
    handover: newHandover(),
    createdAt: u.iso,
    updatedAt: u.iso,
  };
  await insertReservation(u, r);
  await recordHistory(u, r, 'REQUESTER', 'REQUESTED');
  reservationEvents(u, r, 'REQUESTED');
  if (priority) await saveWaitlist(u, { ...priority, status: 'APPLIED', reservationId: r.id });
  if (r.ownerId)
    await notify(u, r.ownerId, {
      type: 'RESERVATION_REQUESTED',
      title: '새 대여 신청이 왔어요',
      body: `${(await u.user(actor)).displayName}님 · ${item.title} · ${period(r.startAt, r.endAt)}. ${formatSeoulDateTime(r.responseDueAt!)}까지 응답해 주세요.`,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: item.id,
    });
  return reservationView(u, actor, r, true);
}

async function confirmFromPreview(
  u: Commands,
  actor: string,
  body: CreateReservationBody,
  requestId: string,
  negotiationId: string,
) {
  const request = await u.lockRequest(requestId, actor);
  const ns = await u.lockNegotiations(request.id);
  await u.expire(request, ns);
  const existing = (
    await u.c.query('SELECT data FROM reservations WHERE request_id=$1', [request.id])
  ).rows[0]?.data as Reservation | undefined;
  if (existing) {
    if (existing.negotiationId !== negotiationId) fail('INVALID_STATE');
    return reservationView(u, actor, existing, true);
  }
  const n = ns.find((v) => v.id === negotiationId);
  if (
    !n ||
    request.status !== 'PAYMENT_PREVIEW_READY' ||
    request.selectedNegotiationId !== negotiationId ||
    n.status !== 'SELECTED'
  )
    fail('INVALID_STATE');
  if (
    n.itemId !== body.itemId ||
    n.terms.startAt !== body.startAt ||
    n.terms.endAt !== body.endAt ||
    n.terms.placeId !== body.placeId
  )
    fail('VALIDATION_ERROR', { fields: ['itemId', 'startAt', 'endAt', 'placeId'] });
  await u.lockItems([n.itemId]);
  const hold = (
    await u.c.query('SELECT status, expires_at FROM demo_holds WHERE request_id=$1 FOR UPDATE', [
      request.id,
    ])
  ).rows[0] as { status: string; expires_at: Date } | undefined;
  if (!hold || hold.status !== 'ACTIVE' || hold.expires_at.getTime() <= u.now.getTime()) {
    await u.expireItemHolds(n.itemId);
    fail('OFFER_EXPIRED', {}, true);
  }
  const item = await u.item(n.itemId);
  const reason = (await u.availability(item, actor, n.terms, {
    ignoreHoldRequestId: request.id,
  })) as AvailabilityReason | null;
  if (reason) fail('AVAILABILITY_CONFLICT', { reason, waitlistable: false });
  const r: Reservation = {
    id: id('rsv'),
    itemId: item.id,
    requesterId: actor,
    ownerId: n.ownerId,
    source: n.source,
    origin: 'REQUEST',
    requestId: request.id,
    negotiationId: n.id,
    waitlistEntryId: null,
    status: 'CONFIRMED',
    version: 1,
    startAt: n.terms.startAt,
    endAt: n.terms.endAt,
    placeId: n.terms.placeId,
    totalFeeKrw: n.terms.totalFeeKrw,
    currency: 'KRW',
    item: await u.itemSummary(item),
    responseDueAt: null,
    closedReason: null,
    handover: newHandover(),
    createdAt: u.iso,
    updatedAt: u.iso,
  };
  await insertReservation(u, r);
  // 10분 데모 점유는 확정 예약이 이어받는다.
  await u.c.query("UPDATE demo_holds SET status='RELEASED' WHERE request_id=$1", [request.id]);
  await afterConfirmed(u, r, 'REQUESTER', 'PREVIEW_CONFIRMED');
  return reservationView(u, actor, r, true);
}

/** 예약 행을 읽고(권한 확인) 물품 → 예약 순서로 잠근다. */
async function lockForCommand(
  u: Commands,
  reservationId: string,
  check: (r: Reservation) => boolean,
) {
  const peek = await read<Reservation>(u.c, 'reservations', reservationId);
  if (!peek || !check(peek)) fail('NOT_FOUND');
  await u.lockItems([peek.itemId]);
  return lockReservation(u, reservationId);
}

const pastDue = (u: Unit, r: Reservation) =>
  r.status === 'PENDING' && !!r.responseDueAt && Date.parse(r.responseDueAt) <= u.now.getTime();

export async function respondReservation(
  u: Commands,
  actor: string,
  reservationId: string,
  body: RespondReservationBody,
) {
  const r = await lockForCommand(
    u,
    reservationId,
    (v) => v.ownerId === actor && v.source === 'RESIDENT',
  );
  if (pastDue(u, r)) {
    await expireReservation(u, r);
    fail('OFFER_EXPIRED', {}, true);
  }
  if (r.version !== body.expectedVersion) fail('VERSION_CONFLICT', { currentVersion: r.version });
  if (r.status !== 'PENDING') fail('INVALID_STATE');
  if (body.action === 'DECLINE') {
    r.status = 'DECLINED';
    r.closedReason = body.reasonCode;
    r.responseDueAt = null;
    await updateReservation(u, r);
    await recordHistory(u, r, 'OWNER', body.reasonCode);
    reservationEvents(u, r, 'OWNER_DECLINED');
    await closeLinkedWaitlist(u, r, 'RESERVATION_DECLINED');
    await notify(u, r.requesterId, {
      type: 'RESERVATION_DECLINED',
      title: '예약 신청이 거절됐어요',
      body: `${r.item.title} · ${period(r.startAt, r.endAt)}. 다른 기간이나 물품을 찾아보세요.`,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: r.itemId,
    });
    await promoteWaitlist(u, r.itemId);
    return reservationView(u, actor, r, true);
  }
  const item = await u.item(r.itemId);
  const reason = (await u.availability(item, r.requesterId, r)) as AvailabilityReason | null;
  if (reason) {
    // 잠시 뒤 풀리는 점유(10분 데모 점유·대기 우선권)는 신청을 그대로 두고 다시 승인할 수 있게 한다.
    if (reason === 'ACTIVE_HOLD' || reason === 'WAITLIST_PRIORITY')
      fail('AVAILABILITY_CONFLICT', { reason, waitlistable: false });
    // 물품 조건이 바뀌어 다시 승인할 수 없는 신청은 닫고 신청자에게 알린다(리뷰 지적).
    await declineBySystem(u, r, reason);
    fail('AVAILABILITY_CONFLICT', { reason, waitlistable: false, closed: true }, true);
  }
  r.status = 'CONFIRMED';
  r.responseDueAt = null;
  await updateReservation(u, r);
  await afterConfirmed(u, r, 'OWNER', 'OWNER_APPROVED');
  return reservationView(u, actor, r, true);
}

export async function cancelReservation(
  u: Commands,
  actor: string,
  reservationId: string,
  expectedVersion: number,
) {
  const r = await lockForCommand(u, reservationId, (v) => v.requesterId === actor);
  if (pastDue(u, r)) {
    await expireReservation(u, r);
    fail('INVALID_STATE', {}, true);
  }
  if (r.version !== expectedVersion) fail('VERSION_CONFLICT', { currentVersion: r.version });
  const confirmed = r.status === 'CONFIRMED';
  if (!(
    r.status === 'PENDING' ||
    (confirmed && Date.parse(r.startAt) > u.now.getTime() && notHandedOver(r))
  ))
    fail('INVALID_STATE');
  r.status = 'CANCELLED';
  r.closedReason = 'REQUESTER_CANCELLED';
  r.responseDueAt = null;
  await updateReservation(u, r);
  await recordHistory(u, r, 'REQUESTER', 'REQUESTER_CANCELLED');
  reservationEvents(u, r, 'REQUESTER_CANCELLED');
  await closeLinkedWaitlist(u, r, 'RESERVATION_CANCELLED');
  if (r.ownerId)
    await notify(u, r.ownerId, {
      type: 'RESERVATION_CANCELLED',
      title: confirmed ? '확정된 예약이 취소됐어요' : '대여 신청이 취소됐어요',
      body: `${(await u.user(r.requesterId)).displayName}님 · ${r.item.title} · ${period(r.startAt, r.endAt)}`,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: r.itemId,
    });
  // 확정 취소는 점유를 풀기 때문에 대기 1순위를 바로 검토한다.
  await promoteWaitlist(u, r.itemId);
  return reservationView(u, actor, r, true);
}

// ---------------------------------------------------------------------------------------------
// 거점 인계·반납(명세 0007): 관리자만 진행한다. 예약 status는 CONFIRMED로 둔다.

export type HandoverPhoto = { contentType: string; bytes: Buffer };
export type ReturnCompare = (
  before: HandoverPhoto,
  after: HandoverPhoto,
) => Promise<ReturnComparison>;

// ponytail: 31자 중 randomBytes % 31의 미세한 치우침은 무시한다. 코드가 보안 비밀이 되면 rejection sampling으로.
const handoverCode = () =>
  Array.from(randomBytes(8), (b) => HANDOVER_CODE_ALPHABET[b % HANDOVER_CODE_ALPHABET.length]).join(
    '',
  );
function newHandover(): Handover {
  return {
    code: handoverCode(),
    stage: 'READY',
    pickedUpAt: null,
    pickupPhotoId: null,
    returnedAt: null,
    returnPhotoId: null,
    comparison: null,
    inspection: null,
  };
}
function withoutCode({ code: _code, ...rest }: Handover): Handover {
  return rest;
}
const notHandedOver = (r: Reservation) => !r.handover || r.handover.stage === 'READY';

async function handoverView(u: Unit, r: Reservation): Promise<HandoverView> {
  return {
    reservation: { ...r, handover: r.handover ?? null },
    requesterDisplayName: (await u.user(r.requesterId)).displayName,
    ownerDisplayName: r.item.ownerDisplayName ?? null,
    placeLabel: await placeLabel(u, r.placeId),
  };
}

async function reservationIdByCode(u: Unit, actor: string, code: string): Promise<string> {
  if (actor !== HUB_MANAGER_ID) fail('NOT_FOUND');
  const row = await u.c.query("SELECT id FROM reservations WHERE data->'handover'->>'code'=$1", [
    code,
  ]);
  return (row.rows[0]?.id as string | undefined) ?? fail('NOT_FOUND');
}

export async function getHandover(u: Unit, actor: string, code: string) {
  const r = await read<Reservation>(u.c, 'reservations', await reservationIdByCode(u, actor, code));
  return handoverView(u, r!);
}

/** 코드로 찾아 물품 → 예약 순서로 잠그고, 버전·상태·단계를 확인한다. */
async function lockHandover(
  u: Commands,
  actor: string,
  code: string,
  expectedVersion: number,
  stage: Handover['stage'],
) {
  const r = await lockForCommand(u, await reservationIdByCode(u, actor, code), () => true);
  if (r.version !== expectedVersion) fail('VERSION_CONFLICT', { currentVersion: r.version });
  if (r.status !== 'CONFIRMED' || r.handover?.stage !== stage) fail('INVALID_STATE');
  return { r, handover: r.handover };
}

async function managerPhoto(u: Unit, actor: string, photoId: string): Promise<HandoverPhoto> {
  const row = await u.c.query(
    'SELECT content_type, bytes FROM item_images WHERE id=$1 AND owner_id=$2',
    [photoId, actor],
  );
  const photo = row.rows[0] as { content_type: string; bytes: Buffer } | undefined;
  if (!photo) fail('NOT_FOUND');
  return { contentType: photo.content_type, bytes: photo.bytes };
}

async function notifyBoth(
  u: Unit,
  r: Reservation,
  input: Omit<Parameters<typeof notify>[2], 'reservationId' | 'itemId'>,
) {
  for (const userId of new Set([r.requesterId, ...(r.ownerId ? [r.ownerId] : [])]))
    await notify(u, userId, {
      ...input,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: r.itemId,
    });
}

export async function recordPickup(
  u: Commands,
  actor: string,
  code: string,
  body: HandoverPhotoBody,
) {
  const { r, handover } = await lockHandover(u, actor, code, body.expectedVersion, 'READY');
  if (Date.parse(r.endAt) <= u.now.getTime()) fail('INVALID_STATE');
  await managerPhoto(u, actor, body.photoId);
  r.handover = { ...handover, stage: 'PICKED_UP', pickedUpAt: u.iso, pickupPhotoId: body.photoId };
  await updateReservation(u, r);
  await recordHistory(u, r, 'HUB', 'HANDOVER_PICKED_UP');
  reservationEvents(u, r, 'HANDOVER_PICKED_UP');
  await notifyBoth(u, r, {
    type: 'HANDOVER_PICKED_UP',
    title: '거점에서 물건을 인계했어요',
    body: `${r.item.title} · ${await placeLabel(u, r.placeId)}. 반납은 ${formatSeoulDateTime(r.endAt)}까지 같은 거점으로 해 주세요.`,
  });
  return handoverView(u, r);
}

/** 반납 사진을 기록하고 AI 비교 후보를 붙인다. AI 실패는 FAILED로 남기고 관리자 판정으로 넘어간다. */
export async function recordReturn(
  u: Commands,
  actor: string,
  code: string,
  body: HandoverPhotoBody,
  compare: ReturnCompare,
) {
  const { r, handover } = await lockHandover(u, actor, code, body.expectedVersion, 'PICKED_UP');
  const after = await managerPhoto(u, actor, body.photoId);
  const before = await managerPhoto(u, actor, handover.pickupPhotoId!);
  // ponytail: AI 비교가 예약 잠금 안에서 수 초 실행된다(2번 등록과 같은 제약). 반납이 몰리면 비동기 작업으로 분리.
  let comparison: ReturnComparison;
  try {
    comparison = await compare(before, after);
  } catch {
    comparison = { status: 'FAILED', summary: null, differences: [] };
  }
  u.refreshClock();
  r.handover = {
    ...handover,
    stage: 'RETURNED',
    returnedAt: u.iso,
    returnPhotoId: body.photoId,
    comparison,
  };
  await updateReservation(u, r);
  await recordHistory(u, r, 'HUB', 'HANDOVER_RETURNED');
  reservationEvents(u, r, 'HANDOVER_RETURNED');
  return handoverView(u, r);
}

export async function recordInspection(
  u: Commands,
  actor: string,
  code: string,
  body: InspectBody,
) {
  const { r, handover } = await lockHandover(u, actor, code, body.expectedVersion, 'RETURNED');
  r.handover = {
    ...handover,
    stage: 'COMPLETED',
    inspection: { result: body.result, note: body.note || null, at: u.iso },
  };
  await updateReservation(u, r);
  const reason = body.result === 'OK' ? 'INSPECTED_OK' : 'INSPECTED_DAMAGED';
  await recordHistory(u, r, 'HUB', reason);
  reservationEvents(u, r, reason);
  await notifyBoth(u, r, {
    type: 'HANDOVER_RETURNED',
    title: body.result === 'OK' ? '반납이 확인됐어요' : '반납 물품에 파손이 확인됐어요',
    body:
      body.result === 'OK'
        ? `${r.item.title} · 거점 관리자가 상태를 확인했어요. 이용해 주셔서 고마워요.`
        : `${r.item.title} · ${body.note}. 센터에서 처리 방법을 안내할 예정이에요.`,
  });
  return handoverView(u, r);
}

/** 물품 조건 변경(비활성·불가 기간·장소 등)으로 더 진행할 수 없는 신청을 닫는다. */
async function declineBySystem(u: Commands, r: Reservation, reason: string) {
  r.status = 'DECLINED';
  r.closedReason = reason;
  r.responseDueAt = null;
  await updateReservation(u, r);
  await recordHistory(u, r, 'SYSTEM', reason);
  reservationEvents(u, r, reason);
  await closeLinkedWaitlist(u, r, 'RESERVATION_DECLINED');
  await notify(u, r.requesterId, {
    type: 'RESERVATION_DECLINED',
    title: '예약 신청을 이어갈 수 없어요',
    body: `${r.item.title} · ${period(r.startAt, r.endAt)}. 물품의 대여 조건이 바뀌었어요. 다른 기간이나 물품을 찾아보세요.`,
    link: `/reservations/${r.id}`,
    reservationId: r.id,
    itemId: r.itemId,
  });
  await promoteWaitlist(u, r.itemId);
}

async function expireReservation(u: Commands, r: Reservation) {
  r.status = 'EXPIRED';
  r.closedReason = 'RESPONSE_EXPIRED';
  r.responseDueAt = null;
  await updateReservation(u, r);
  await recordHistory(u, r, 'SYSTEM', 'RESPONSE_EXPIRED');
  reservationEvents(u, r, 'RESPONSE_EXPIRED');
  await closeLinkedWaitlist(u, r, 'RESERVATION_EXPIRED');
  await notify(u, r.requesterId, {
    type: 'RESERVATION_EXPIRED',
    title: '응답 기한이 지나 신청이 만료됐어요',
    body: `${r.item.title} · ${period(r.startAt, r.endAt)}. 다른 기간이나 물품을 찾아보세요.`,
    link: `/reservations/${r.id}`,
    reservationId: r.id,
    itemId: r.itemId,
  });
  if (r.ownerId)
    await notify(u, r.ownerId, {
      type: 'RESERVATION_EXPIRED',
      title: '응답하지 않은 신청이 만료됐어요',
      body: `${(await u.user(r.requesterId)).displayName}님 · ${r.item.title} · ${period(r.startAt, r.endAt)}`,
      link: `/reservations/${r.id}`,
      reservationId: r.id,
      itemId: r.itemId,
    });
  await promoteWaitlist(u, r.itemId);
}

/** 공공 물품 모의 응답: 물품의 publicScenario와 가용성으로 결정한다. */
async function publicDecision(u: Commands, r: Reservation) {
  const item = await u.item(r.itemId);
  const reason = (await u.availability(item, r.requesterId, r)) as AvailabilityReason | null;
  if (!reason && item.publicScenario === 'APPROVE') {
    r.status = 'CONFIRMED';
    r.responseDueAt = null;
    await updateReservation(u, r);
    await afterConfirmed(u, r, 'PUBLIC_DEMO', 'PUBLIC_DEMO_APPROVED');
    return;
  }
  r.status = 'DECLINED';
  r.closedReason = reason ?? 'PUBLIC_DEMO_DECLINED';
  r.responseDueAt = null;
  await updateReservation(u, r);
  await recordHistory(u, r, 'PUBLIC_DEMO', r.closedReason);
  reservationEvents(u, r, 'PUBLIC_DEMO_DECLINED');
  await closeLinkedWaitlist(u, r, 'RESERVATION_DECLINED');
  await notify(u, r.requesterId, {
    type: 'RESERVATION_DECLINED',
    title: '센터에서 신청을 받지 못했어요',
    body: `${r.item.title} · ${period(r.startAt, r.endAt)}. 시연용 센터 응답이에요. 다른 기간이나 물품을 찾아보세요.`,
    link: `/reservations/${r.id}`,
    reservationId: r.id,
    itemId: r.itemId,
  });
  await promoteWaitlist(u, r.itemId);
}

// ---------------------------------------------------------------------------------------------
// 대기열

type StoredWaitlistEntry = Omit<WaitlistEntry, 'position'>;

async function saveWaitlist(u: Unit, entry: StoredWaitlistEntry, insert = false) {
  const next: StoredWaitlistEntry = insert
    ? entry
    : { ...entry, version: entry.version + 1, updatedAt: u.iso };
  checked(WaitlistEntrySchema, { ...next, position: null }, 'waitlist entry');
  if (insert)
    await u.c.query(
      'INSERT INTO waitlist_entries(id,data,item_id,user_id,status,start_at,end_at,priority_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        next.id,
        next,
        next.itemId,
        next.userId,
        next.status,
        next.startAt,
        next.endAt,
        next.priorityUntil,
      ],
    );
  else
    await u.c.query('UPDATE waitlist_entries SET data=$2,status=$3,priority_until=$4 WHERE id=$1', [
      next.id,
      next,
      next.status,
      next.priorityUntil,
    ]);
  u.event(next.userId, { type: 'waitlist.updated', waitlistEntryId: next.id, reason: next.status });
  return next;
}

/** 우선권으로 낸 신청이 거절·만료·취소되면 우선권을 끝내고 다음 순위로 넘긴다. */
async function closeLinkedWaitlist(u: Unit, r: Reservation, reason: string) {
  if (!r.waitlistEntryId) return;
  const row = await u.c.query('SELECT data FROM waitlist_entries WHERE id=$1 FOR UPDATE', [
    r.waitlistEntryId,
  ]);
  const entry = row.rows[0]?.data as StoredWaitlistEntry | undefined;
  if (entry?.status === 'APPLIED' && entry.reservationId === r.id)
    await saveWaitlist(u, {
      ...entry,
      status: 'EXPIRED',
      priorityUntil: null,
      closedReason: reason,
    });
}

async function positions(u: Unit, entries: StoredWaitlistEntry[]): Promise<WaitlistEntry[]> {
  const result: WaitlistEntry[] = [];
  for (const entry of entries) {
    let position: number | null = null;
    if (OPEN.includes(entry.status)) {
      const row = await u.c.query(
        "SELECT count(*)::int AS n FROM waitlist_entries WHERE item_id=$1 AND status IN ('WAITING','NOTIFIED','APPLIED') AND seq <= (SELECT seq FROM waitlist_entries WHERE id=$2)",
        [entry.itemId, entry.id],
      );
      position = (row.rows[0].n as number) || null;
    }
    result.push({ ...entry, position });
  }
  return result;
}

export async function createWaitlistEntry(
  u: Commands,
  actor: string,
  body: CreateWaitlistEntryBody,
): Promise<WaitlistEntry> {
  if (!validatePeriod(body.startAt, body.endAt, u.now).valid)
    fail('VALIDATION_ERROR', { fields: ['startAt'] });
  if (!(await read<Item>(u.c, 'items', body.itemId))) fail('NOT_FOUND');
  await u.lockItems([body.itemId]);
  const item = await u.item(body.itemId);
  if (!item.enabled) fail('NOT_FOUND');
  const waiting = await u.c.query(
    "SELECT 1 FROM waitlist_entries WHERE item_id=$1 AND user_id=$2 AND status IN ('WAITING','NOTIFIED','APPLIED') AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') LIMIT 1",
    [item.id, actor, body.startAt, body.endAt],
  );
  if (waiting.rowCount) fail('ALREADY_WAITLISTED');
  const mine = await u.c.query(
    "SELECT 1 FROM reservations WHERE item_id=$1 AND requester_id=$2 AND status IN ('PENDING','CONFIRMED') AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)') LIMIT 1",
    [item.id, actor, body.startAt, body.endAt],
  );
  if (mine.rowCount) fail('DUPLICATE_RESERVATION');
  const reason = (await u.availability(item, actor, {
    ...body,
    placeId: item.allowedPlaceIds[0]!,
  })) as AvailabilityReason | null;
  if (!reason || !WAITLISTABLE_REASONS.includes(reason)) fail('NOT_WAITLISTABLE', { reason });
  const entry: StoredWaitlistEntry = {
    id: id('wl'),
    itemId: item.id,
    userId: actor,
    startAt: body.startAt,
    endAt: body.endAt,
    status: 'WAITING',
    version: 1,
    priorityUntil: null,
    reservationId: null,
    closedReason: null,
    item: await u.itemSummary(item),
    createdAt: u.iso,
    updatedAt: u.iso,
  };
  await saveWaitlist(u, entry, true);
  return (await positions(u, [entry]))[0]!;
}

export async function listWaitlistEntries(u: Unit, actor: string, status?: WaitlistStatus) {
  const rows = await all<StoredWaitlistEntry>(
    u.c,
    'waitlist_entries',
    'WHERE user_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY seq',
    [actor, status ?? null],
  );
  return positions(u, rows);
}

export async function cancelWaitlistEntry(
  u: Commands,
  actor: string,
  entryId: string,
  expectedVersion?: number,
) {
  const peek = await read<StoredWaitlistEntry>(u.c, 'waitlist_entries', entryId);
  if (!peek || peek.userId !== actor) fail('NOT_FOUND');
  await u.lockItems([peek.itemId]);
  const entry = (
    await u.c.query('SELECT data FROM waitlist_entries WHERE id=$1 FOR UPDATE', [entryId])
  ).rows[0].data as StoredWaitlistEntry;
  if (expectedVersion !== undefined && entry.version !== expectedVersion)
    fail('VERSION_CONFLICT', { currentVersion: entry.version });
  if (!OPEN.includes(entry.status)) fail('INVALID_STATE');
  const saved = await saveWaitlist(u, {
    ...entry,
    status: 'CANCELLED',
    priorityUntil: null,
    closedReason: 'USER_CANCELLED',
  });
  if (entry.status !== 'WAITING') await promoteWaitlist(u, entry.itemId);
  return (await positions(u, [saved]))[0]!;
}

/**
 * 물품의 대기를 순번대로 검토한다. 호출자는 물품 행을 잠근 상태여야 한다.
 * 1) 시작 시각이 지난 대기와 신청하지 않고 지난 우선권을 끝낸다.
 * 2) WAITING 중 기간이 지금 가용(다른 사람의 우선권과도 겹치지 않음)한 첫 대기에 우선권을 준다.
 *    저장 즉시 DB 검사에 반영되므로, 겹치는 다음 순번은 WAITLIST_PRIORITY로 기다린다.
 */
export async function promoteWaitlist(u: Commands, itemId: string): Promise<number> {
  const entries = (
    await u.c.query(
      "SELECT data FROM waitlist_entries WHERE item_id=$1 AND status IN ('WAITING','NOTIFIED','APPLIED') ORDER BY seq FOR UPDATE",
      [itemId],
    )
  ).rows.map((row) => row.data as StoredWaitlistEntry);
  if (!entries.length) return 0;
  const now = u.now.getTime();
  const item = await u.item(itemId);
  let promoted = 0;
  for (const entry of entries) {
    if (
      entry.status === 'NOTIFIED' &&
      entry.priorityUntil &&
      Date.parse(entry.priorityUntil) <= now
    ) {
      await saveWaitlist(u, {
        ...entry,
        status: 'EXPIRED',
        priorityUntil: null,
        closedReason: 'PRIORITY_EXPIRED',
      });
      await notify(u, entry.userId, {
        type: 'WAITLIST_EXPIRED',
        title: '우선 신청 시간이 지났어요',
        body: `${entry.item.title} · ${period(entry.startAt, entry.endAt)}. 다음 대기자에게 차례가 넘어갔어요.`,
        link: `/catalog/${entry.itemId}`,
        waitlistEntryId: entry.id,
        itemId: entry.itemId,
      });
      entry.status = 'EXPIRED';
    } else if (entry.status !== 'APPLIED' && Date.parse(entry.startAt) <= now) {
      await saveWaitlist(u, {
        ...entry,
        status: 'EXPIRED',
        priorityUntil: null,
        closedReason: 'PERIOD_STARTED',
      });
      entry.status = 'EXPIRED';
    }
  }
  const priorityMsValue = await priorityMs(u);
  for (const entry of entries) {
    if (entry.status !== 'WAITING') continue;
    const reason = await u.availability(item, entry.userId, {
      startAt: entry.startAt,
      endAt: entry.endAt,
      placeId: item.allowedPlaceIds[0]!,
    });
    if (reason) continue;
    const priorityUntil = new Date(
      Math.min(now + priorityMsValue, Date.parse(entry.startAt)),
    ).toISOString();
    await saveWaitlist(u, { ...entry, status: 'NOTIFIED', priorityUntil });
    entry.status = 'NOTIFIED';
    promoted++;
    const query = new URLSearchParams({ startAt: entry.startAt, endAt: entry.endAt });
    await notify(u, entry.userId, {
      type: 'WAITLIST_AVAILABLE',
      title: '기다리던 기간이 비었어요',
      body: `${entry.item.title} · ${period(entry.startAt, entry.endAt)}. ${formatSeoulDateTime(priorityUntil)}까지 먼저 신청할 수 있어요.`,
      link: `/catalog/${entry.itemId}?${query.toString()}`,
      waitlistEntryId: entry.id,
      itemId: entry.itemId,
    });
  }
  return promoted;
}

// ---------------------------------------------------------------------------------------------
// 카탈로그(읽기)

function catalogItem(
  item: Item,
  actor: string,
  ownerDisplayName: string | null,
  availability: CatalogItem['availability'],
): CatalogItem {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    source: item.source,
    image: item.image,
    ownerDisplayName,
    dailyRateKrw: item.dailyRateKrw,
    allowedPlaceIds: item.allowedPlaceIds,
    mine: item.ownerId === actor,
    availability,
  };
}

async function periodAvailability(
  u: Commands,
  item: Item,
  actor: string,
  startAt: string,
  endAt: string,
) {
  const reason = (await u.availability(item, actor, {
    startAt,
    endAt,
    placeId: item.allowedPlaceIds[0]!,
  })) as AvailabilityReason | null;
  const fee = reservationFee(item.dailyRateKrw, startAt, endAt, item.source);
  return {
    status: reason ? ('UNAVAILABLE' as const) : ('AVAILABLE' as const),
    reason,
    billingDays: fee.billingDays,
    totalFeeKrw: fee.totalFeeKrw,
  };
}

export async function listCatalog(u: Commands, actor: string, q: CatalogQuery) {
  const items = (
    await all<Item>(u.c, 'items', "WHERE (data->>'enabled')::boolean ORDER BY id")
  ).filter(
    (item) =>
      (!q.category || item.category === q.category) &&
      (!q.source || item.source === q.source) &&
      (!q.q || matchesItem(q.q, item)),
  );
  const result: CatalogItem[] = [];
  for (const item of items)
    result.push(
      catalogItem(
        item,
        actor,
        (await u.itemSummary(item)).ownerDisplayName,
        q.startAt && q.endAt ? await periodAvailability(u, item, actor, q.startAt, q.endAt) : null,
      ),
    );
  return result;
}

async function enabledItem(u: Commands, itemId: string) {
  const item = await read<Item>(u.c, 'items', itemId);
  if (!item?.enabled) fail('NOT_FOUND');
  return item;
}

async function waitingCount(u: Unit, itemId: string) {
  return (
    await u.c.query(
      "SELECT count(*)::int AS n FROM waitlist_entries WHERE item_id=$1 AND status IN ('WAITING','NOTIFIED','APPLIED')",
      [itemId],
    )
  ).rows[0].n as number;
}

export async function catalogDetail(
  u: Commands,
  actor: string,
  itemId: string,
  description: string | null,
): Promise<CatalogItemDetail> {
  const item = await enabledItem(u, itemId);
  const now = u.now.getTime();
  const horizon = now + 90 * 24 * 60 * 60 * 1000;
  const clip = (startAt: string, endAt: string, kind: OccupiedPeriod['kind']): OccupiedPeriod => ({
    startAt: new Date(Math.max(Date.parse(startAt), now)).toISOString(),
    endAt: new Date(Math.min(Date.parse(endAt), horizon)).toISOString(),
    kind,
  });
  const occupied: OccupiedPeriod[] = [];
  const reserved = await u.c.query(
    "SELECT start_at, end_at FROM reservations WHERE item_id=$1 AND status='CONFIRMED' AND end_at>$2 ORDER BY start_at LIMIT 20",
    [item.id, u.iso],
  );
  for (const row of reserved.rows)
    occupied.push(clip(row.start_at.toISOString(), row.end_at.toISOString(), 'RESERVED'));
  const held = await u.c.query(
    "SELECT start_at, end_at FROM demo_holds WHERE item_id=$1 AND status='ACTIVE' AND expires_at>$2 AND end_at>$2 ORDER BY start_at LIMIT 20",
    [item.id, u.iso],
  );
  for (const row of held.rows)
    occupied.push(clip(row.start_at.toISOString(), row.end_at.toISOString(), 'HELD'));
  for (const p of item.unavailableIntervals)
    if (Date.parse(p.endAt) > now && Date.parse(p.startAt) < horizon)
      occupied.push(clip(p.startAt, p.endAt, 'UNAVAILABLE'));
  occupied.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return {
    ...catalogItem(item, actor, (await u.itemSummary(item)).ownerDisplayName, null),
    description,
    occupied: occupied.filter((p) => p.startAt < p.endAt).slice(0, 20),
    waitingCount: await waitingCount(u, item.id),
  };
}

export async function itemAvailability(
  u: Commands,
  actor: string,
  itemId: string,
  startAt: string,
  endAt: string,
): Promise<ItemAvailability> {
  if (!validatePeriod(startAt, endAt, u.now).valid)
    fail('VALIDATION_ERROR', { fields: ['startAt'] });
  const item = await enabledItem(u, itemId);
  const a = await periodAvailability(u, item, actor, startAt, endAt);
  return {
    itemId: item.id,
    startAt,
    endAt,
    ...a,
    waitlistable: !!a.reason && WAITLISTABLE_REASONS.includes(a.reason),
    waitingCount: await waitingCount(u, item.id),
  };
}

// ---------------------------------------------------------------------------------------------
// 주기 정리(worker): 응답 기한 만료, 공공 모의 응답, 대기 우선권 만료·승계, 오래된 알림 정리.

export async function sweepReservations(db: Database, now?: Date) {
  const at = now ?? db.now();
  const due = await db.pool.query(
    "SELECT id FROM reservations WHERE status='PENDING' AND (response_due_at<=$1 OR owner_id IS NULL) ORDER BY id",
    [at.toISOString()],
  );
  let changed = 0;
  // 한 건의 실패가 나머지 정리와 다른 worker 작업을 막지 않도록 건별로 격리하고, 끝에 알린다.
  let firstError: unknown = null;
  const isolated = async (work: () => Promise<number>) => {
    try {
      changed += await work();
    } catch (error) {
      firstError ??= error;
    }
  };
  for (const row of due.rows)
    await isolated(() =>
      db.transaction(async (u) => {
        const peek = await read<Reservation>(u.c, 'reservations', row.id);
        if (!peek || peek.status !== 'PENDING') return 0;
        await u.lockItems([peek.itemId]);
        const r = await lockReservation(u, peek.id);
        if (r.status !== 'PENDING') return 0;
        if (pastDue(u, r)) await expireReservation(u, r);
        else if (r.source === 'PUBLIC') await publicDecision(u, r);
        else return 0;
        return 1;
      }, now),
    );
  const items = await db.pool.query(
    "SELECT DISTINCT item_id FROM waitlist_entries WHERE status IN ('WAITING','NOTIFIED','APPLIED') ORDER BY item_id",
  );
  for (const row of items.rows)
    await isolated(() =>
      db.transaction(async (u) => {
        await u.lockItems([row.item_id]);
        return promoteWaitlist(u, row.item_id);
      }, now),
    );
  await db.pool.query('DELETE FROM notifications WHERE created_at<$1', [
    new Date(at.getTime() - NOTIFICATION_RETENTION_MS).toISOString(),
  ]);
  if (firstError) throw firstError;
  return changed;
}

export const isOpenWaitlist = (entry: Pick<WaitlistEntry, 'status'>) => OPEN.includes(entry.status);
export { overlaps as periodsOverlap };
