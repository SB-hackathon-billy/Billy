// 3번 물품 탐색·예약·대기·앱 알림 API. 명세: docs/specs/0004-reservations-waitlist-notifications.md
// 쓰기는 기존 mutation 래퍼(세션·CSRF·Idempotency-Key·멱등 재생)를 쓰고, 도메인 규칙은 @sb/db의 3번 모듈에 있다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as C from '@sb/contracts';
import {
  cancelReservation,
  cancelWaitlistEntry,
  catalogDetail,
  createReservation,
  createWaitlistEntry,
  getReservation,
  itemAvailability,
  listCatalog,
  listNotifications,
  listReservations,
  listWaitlistEntries,
  readNotifications,
  respondReservation,
} from '@sb/db';
import { paginate } from '../index.js';
import { publishedListingDescription } from '../listings/index.js';

/** 최신순 정렬 키: 작은 값이 먼저 오도록 시각을 뒤집는다. */
const newestFirst = (iso: string, id: string) =>
  `${String(9_999_999_999_999 - Date.parse(iso)).padStart(13, '0')}:${id}`;

export default async function reservationsPlugin(app: FastifyInstance) {
  const { db, envelope, requireSession, mutation } = app.demo;
  const param = (request: FastifyRequest) =>
    C.IdSchema.parse((request.params as { id: string }).id);
  const get = (path: string, fn: (request: FastifyRequest) => Promise<unknown>) =>
    app.get(`/api/v1${path}`, async (request) => envelope(await fn(request)));

  get('/catalog', async (request) => {
    const actor = requireSession(request).userId;
    const q = C.CatalogQuerySchema.parse(request.query);
    const items = await db.transaction((u) => listCatalog(u, actor, q));
    return paginate(
      items,
      q,
      (item) => `${item.source === 'PUBLIC' ? 0 : 1}:${item.id}`,
      `catalog:${actor}:${[q.q, q.category, q.source, q.startAt, q.endAt].map((v) => v ?? '').join(':')}`,
    );
  });
  get('/catalog/:id', async (request) => {
    const actor = requireSession(request).userId;
    const itemId = param(request);
    return db.transaction(async (u) =>
      catalogDetail(u, actor, itemId, await publishedListingDescription(u, itemId)),
    );
  });
  get('/catalog/:id/availability', async (request) => {
    const actor = requireSession(request).userId;
    const q = C.ItemAvailabilityQuerySchema.parse(request.query);
    return db.transaction((u) => itemAvailability(u, actor, param(request), q.startAt, q.endAt));
  });

  mutation('POST', '/reservations', 201, (u, request) =>
    createReservation(
      u,
      requireSession(request).userId,
      C.CreateReservationBodySchema.parse(request.body),
    ),
  );
  get('/reservations', async (request) => {
    const actor = requireSession(request).userId;
    const q = C.ReservationsQuerySchema.parse(request.query);
    const views = await db.transaction((u) => listReservations(u, actor, q));
    return paginate(
      views,
      q,
      (v) => newestFirst(v.reservation.createdAt, v.reservation.id),
      `reservations:${actor}:${q.role}:${q.status ?? ''}:${q.requestId ?? ''}`,
    );
  });
  get('/reservations/:id', (request) =>
    db.transaction((u) => getReservation(u, requireSession(request).userId, param(request))),
  );
  mutation('POST', '/reservations/:id/respond', 200, (u, request) =>
    respondReservation(
      u,
      requireSession(request).userId,
      param(request),
      C.RespondReservationBodySchema.parse(request.body),
    ),
  );
  mutation('POST', '/reservations/:id/cancel', 200, (u, request) =>
    cancelReservation(
      u,
      requireSession(request).userId,
      param(request),
      C.ReservationVersionBodySchema.parse(request.body).expectedVersion,
    ),
  );

  mutation('POST', '/waitlist-entries', 201, (u, request) =>
    createWaitlistEntry(
      u,
      requireSession(request).userId,
      C.CreateWaitlistEntryBodySchema.parse(request.body),
    ),
  );
  get('/waitlist-entries', async (request) => {
    const actor = requireSession(request).userId;
    const q = C.WaitlistQuerySchema.parse(request.query);
    const entries = await db.transaction((u) => listWaitlistEntries(u, actor, q.status));
    return paginate(
      entries,
      q,
      (e) => newestFirst(e.createdAt, e.id),
      `waitlist:${actor}:${q.status ?? ''}`,
    );
  });
  mutation('DELETE', '/waitlist-entries/:id', 200, (u, request) => {
    if (request.body !== undefined && request.body !== null)
      C.ReservationVersionBodySchema.partial().strict().parse(request.body);
    return cancelWaitlistEntry(u, requireSession(request).userId, param(request));
  });

  get('/notifications', async (request) => {
    const actor = requireSession(request).userId;
    const q = C.NotificationsQuerySchema.parse(request.query);
    const { items, unreadCount } = await db.transaction((u) =>
      listNotifications(u, actor, q.unread === 'true'),
    );
    const page = paginate(
      items,
      q,
      (n) => String(Number.MAX_SAFE_INTEGER - Number(n.seq)).padStart(16, '0'),
      `notifications:${actor}:${q.unread ?? ''}`,
    );
    return {
      items: page.items.map(({ seq: _seq, ...n }) => n),
      nextCursor: page.nextCursor,
      unreadCount,
    };
  });
  mutation('POST', '/notifications/read', 200, (u, request) => {
    const body = C.ReadNotificationsBodySchema.parse(request.body);
    return readNotifications(
      u,
      requireSession(request).userId,
      'all' in body ? 'ALL' : body.notificationIds,
    );
  });
}
