import type { ComparisonRow, RequestView } from '@sb/contracts';
export const categories = {
  CLEANING: '청소',
  TOOLS: '생활 공구',
  TRAVEL: '여행',
  HOBBY: '취미·여가',
} as const;
export const statusLabels: Record<string, string> = {
  DRAFT: '요청 작성 중',
  SEARCHING: '물품 찾는 중',
  MATCHES_READY: '후보 확인',
  COLLECTING_OFFERS: '조건 모으는 중',
  PAYMENT_PREVIEW_READY: '결제 화면 준비 완료',
  NO_MATCH: '맞는 물품 없음',
  FAILED: '다시 확인 필요',
  NO_OFFERS: '제안 종료',
  CANCELLED: '요청 취소됨',
  EXPIRED: '유효시간 종료',
  AWAITING_OWNER: '소유자 응답 대기',
  PENDING_PUBLIC: '센터 데모 확인 중',
  OFFERED: '조건 도착',
  SELECTED: '선택됨',
  DECLINED: '거절됨',
  SUPERSEDED: '다른 물품 선택으로 종료',
  WITHDRAWN: '철회됨',
  UNAVAILABLE: '선택 불가',
};
export const statusLabel = (value: string) => statusLabels[value] ?? '상태 확인 필요';
export const changedLabels = {
  START_AT: '시작 일시 변경',
  END_AT: '종료 일시 변경',
  PLACE: '만남 장소 변경',
  TOTAL_FEE: '총 대여료 변경',
} as const;
export const reasonLabels = {
  SCHEDULE_ADJUSTMENT: '일정 조정',
  PLACE_ADJUSTMENT: '장소 조정',
  PRICE_ADJUSTMENT: '가격 조정',
  UNAVAILABLE: '이용 어려움',
  OTHER_CONDITION: '기타 조건',
} as const;
export function sortComparison(view: RequestView): ComparisonRow[] {
  const matches = (row: ComparisonRow) =>
    Date.parse(row.terms.startAt) === Date.parse(view.request.need.startAt ?? '') &&
    Date.parse(row.terms.endAt) === Date.parse(view.request.need.endAt ?? '') &&
    view.request.need.preferredPlaceIds.includes(row.terms.placeId);
  const created = (row: ComparisonRow) =>
    view.negotiations.find((n) => n.id === row.negotiationId)?.offer?.createdAt ?? '9999';
  return [...view.comparison].sort(
    (a, b) =>
      Number(b.selectable) - Number(a.selectable) ||
      Number(matches(b)) - Number(matches(a)) ||
      a.terms.totalFeeKrw - b.terms.totalFeeKrw ||
      created(a).localeCompare(created(b)),
  );
}
export function secondsRemaining(expiresAt: string, now: number) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}
export function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
}
