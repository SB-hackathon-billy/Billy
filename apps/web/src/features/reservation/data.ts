// 3번 탐색·예약·대기·알림 조회 훅과 표시 문구. 명세: docs/specs/0004-reservations-waitlist-notifications.md
import { infiniteQueryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  CatalogItemDetailSchema,
  CatalogItemSchema,
  ItemAvailabilitySchema,
  NotificationListSchema,
  ReservationViewSchema,
  WaitlistEntrySchema,
  listDataSchema,
  type AvailabilityReason,
  type Category,
  type ItemSource,
  type ReservationStatus,
  type WaitlistStatus,
} from '@sb/contracts';
import { api, idPath } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';
import { allPages } from '../../lib/pagination.js';

export interface CatalogFilters {
  q: string;
  category: Category | '';
  source: ItemSource | '';
  /** 대여소(장소) 필터. 없으면 전체. */
  placeId?: string;
  startAt: string | null;
  endAt: string | null;
}

export function catalogSearch(filters: CatalogFilters, cursor?: string) {
  const params = new URLSearchParams({ limit: '20' });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.source) params.set('source', filters.source);
  if (filters.placeId) params.set('placeId', filters.placeId);
  if (filters.startAt && filters.endAt) {
    params.set('startAt', filters.startAt);
    params.set('endAt', filters.endAt);
  }
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

export function catalogOptions(filters: CatalogFilters) {
  const search = catalogSearch(filters);
  return infiniteQueryOptions({
    queryKey: ['catalog', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api.get(
        `/catalog?${catalogSearch(filters, pageParam)}`,
        listDataSchema(CatalogItemSchema),
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
export function useCatalog(filters: CatalogFilters) {
  return useInfiniteQuery(catalogOptions(filters));
}
export function useCatalogItem(itemId: string) {
  return useQuery({
    queryKey: ['catalog', 'item', itemId],
    queryFn: ({ signal }) => api.get(`/catalog/${idPath(itemId)}`, CatalogItemDetailSchema, signal),
  });
}
export function useAvailability(itemId: string, startAt: string | null, endAt: string | null) {
  return useQuery({
    queryKey: ['catalog', 'availability', itemId, startAt, endAt],
    enabled: !!startAt && !!endAt,
    queryFn: ({ signal }) =>
      api.get(
        `/catalog/${idPath(itemId)}/availability?${new URLSearchParams({
          startAt: startAt!,
          endAt: endAt!,
        }).toString()}`,
        ItemAvailabilitySchema,
        signal,
      ),
    retry: false,
  });
}
export function useReservations(role: 'REQUESTER' | 'OWNER', requestId?: string) {
  const { session } = useSession();
  const params = new URLSearchParams({ role, limit: '50' });
  if (requestId) params.set('requestId', requestId);
  return useQuery({
    queryKey: ['reservations', role, requestId ?? ''],
    enabled: !!session,
    queryFn: ({ signal }) =>
      allPages(
        `/reservations?${params.toString()}`,
        listDataSchema(ReservationViewSchema),
        signal,
        (view) => view.reservation.id,
      ),
  });
}
export function useReservation(id: string) {
  return useQuery({
    queryKey: ['reservation', id],
    queryFn: ({ signal }) => api.get(`/reservations/${idPath(id)}`, ReservationViewSchema, signal),
  });
}
export function useWaitlist(enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: ['waitlist'],
    enabled: !!session && enabled,
    queryFn: ({ signal }) =>
      allPages('/waitlist-entries?limit=50', listDataSchema(WaitlistEntrySchema), signal),
  });
}
export function useNotifications() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['notifications'],
    enabled: !!session,
    queryFn: ({ signal }) => allPages('/notifications?limit=50', NotificationListSchema, signal),
    // 새 알림은 SSE(notification.created)와 재연결 동기화로 갱신한다. 주기 조회는 하지 않는다.
    staleTime: 10_000,
  });
}

export const reservationStatusLabels: Record<ReservationStatus, string> = {
  PENDING: '응답 기다리는 중',
  CONFIRMED: '예약 확정',
  DECLINED: '거절됨',
  CANCELLED: '취소됨',
  EXPIRED: '응답 기한 지남',
};
export const waitlistStatusLabels: Record<WaitlistStatus, string> = {
  WAITING: '대기 중',
  NOTIFIED: '먼저 신청 가능',
  APPLIED: '우선 신청함',
  FULFILLED: '예약됨',
  EXPIRED: '대기 종료',
  CANCELLED: '대기 취소',
};
export const availabilityReasonLabels: Record<AvailabilityReason, string> = {
  ITEM_DISABLED: '지금은 빌려주지 않는 물품이에요.',
  OWN_ITEM: '내가 등록한 물품이에요.',
  OWNER_INELIGIBLE: '소유자가 지금은 빌려줄 수 없어요.',
  DEMO_INELIGIBLE: '이 데모 아이디는 공공 물품 이용 대상이 아니에요.',
  PLACE_UNAVAILABLE: '이 장소에서는 주고받을 수 없어요.',
  PERIOD_STARTED: '이미 시작된 시간이에요. 앞으로의 기간을 골라 주세요.',
  PERIOD_UNAVAILABLE: '소유자가 빌려줄 수 없는 기간이에요.',
  ACTIVE_HOLD: '다른 이웃이 이 기간을 확정하는 중이에요.',
  RESERVED: '이미 예약된 기간이에요.',
  WAITLIST_PRIORITY: '대기 순서가 먼저인 이웃이 신청할 차례예요.',
};
export const closedReasonLabels: Record<string, string> = {
  PERIOD_TAKEN: '같은 기간에 다른 예약이 확정됐어요.',
  PUBLIC_DEMO_DECLINED: '센터에서 신청을 받지 못했어요.',
  RESPONSE_EXPIRED: '응답 기한이 지났어요.',
  REQUESTER_CANCELLED: '신청한 이웃이 취소했어요.',
  SCHEDULE_ADJUSTMENT: '소유자 일정 조정이 필요해요.',
  PLACE_ADJUSTMENT: '소유자 장소 조정이 필요해요.',
  PRICE_ADJUSTMENT: '소유자 가격 조정이 필요해요.',
  UNAVAILABLE: '소유자가 이용이 어렵다고 답했어요.',
  OTHER_CONDITION: '소유자의 다른 조건이 있어요.',
  PRIORITY_EXPIRED: '우선 신청 시간이 지났어요.',
  PERIOD_STARTED: '기간이 시작돼 대기가 끝났어요.',
  USER_CANCELLED: '대기를 취소했어요.',
  RESERVATION_DECLINED: '우선 신청이 거절됐어요.',
  RESERVATION_EXPIRED: '우선 신청의 응답 기한이 지났어요.',
  RESERVATION_CANCELLED: '우선 신청을 취소했어요.',
};
export const closedReasonLabel = (reason: string | null) =>
  reason
    ? (closedReasonLabels[reason] ??
      availabilityReasonLabels[reason as AvailabilityReason] ??
      reason)
    : null;
export const historyLabels: Record<string, string> = {
  REQUESTED: '대여 신청',
  OWNER_APPROVED: '소유자 승인',
  PREVIEW_CONFIRMED: '결제 미리보기에서 확정',
  PUBLIC_DEMO_APPROVED: '센터 승인',
  REQUESTER_CANCELLED: '신청자 취소',
  RESPONSE_EXPIRED: '응답 기한 지남',
  PERIOD_TAKEN: '다른 예약 확정으로 종료',
  HANDOVER_PICKED_UP: '거점에서 인계',
  HANDOVER_RETURNED: '거점에 반납',
  INSPECTED_OK: '반납 확인 · 문제 없음',
  INSPECTED_DAMAGED: '반납 확인 · 파손 있음',
};
export const actorLabels = {
  REQUESTER: '신청자',
  OWNER: '소유자',
  PUBLIC_DEMO: '센터',
  SYSTEM: '자동 처리',
  HUB: '거점 관리자',
} as const;

/** 30분 단위로 올림한 내일 10시~16시(서울) 기본 기간. */
export function defaultPeriod(now = Date.now()) {
  const day = new Date(now + 9 * 3_600_000 + 24 * 3_600_000).toISOString().slice(0, 10);
  return {
    startAt: new Date(`${day}T10:00:00+09:00`).toISOString(),
    endAt: new Date(`${day}T16:00:00+09:00`).toISOString(),
  };
}
