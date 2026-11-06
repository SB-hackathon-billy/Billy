// 접수 체크리스트. 항목은 성북구 1인가구 물품대여 정책 조사(명세 0003 2절)에서 도출했다.
import {
  formatKrw,
  formatSeoulDateTime,
  isNeedCollectionComplete,
  type ExtractNeedResult,
  type NeedDraft,
  type Place,
} from '@sb/contracts';

export type ChecklistKey = 'eligibility' | 'item' | 'startAt' | 'endAt' | 'place' | 'budget';
export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  optional: boolean;
  /** What was recorded, shown once checked. */
  value: string | null;
  /** Hint while still missing. */
  hint: string;
}

export const RENTAL_POLICY = Object.freeze({
  maxDays: 7,
  perItem: 1,
  maxItems: 2,
  pickup: '성북구 1인가구지원센터 (장위로8길 20, 1층) · 평일 09:30–17:30',
  notes: [
    '성북구에 주민등록된 1인가구라면 누구나 무료로 빌릴 수 있어요.',
    '1회 최대 7일, 예약자가 없으면 한 번 연장할 수 있어요.',
    '물품별 1개씩, 한 번에 최대 2개까지 신청해요.',
  ],
});

const DAY_MS = 86_400_000;

export function buildChecklist(
  need: NeedDraft,
  places: readonly Place[],
  eligible: boolean,
): ChecklistItem[] {
  const placeLabels = need.preferredPlaceIds
    .map((id) => places.find((place) => place.id === id)?.label)
    .filter((label): label is string => !!label);
  const days =
    need.startAt && need.endAt
      ? Math.ceil((Date.parse(need.endAt) - Date.parse(need.startAt)) / DAY_MS)
      : 0;
  return [
    {
      key: 'eligibility',
      label: '성북구 1인가구 이용 자격',
      done: eligible,
      optional: false,
      value: eligible ? '회원 정보로 확인됐어요' : null,
      hint: '회원 정보에서 자격 확인이 필요해요',
    },
    {
      key: 'item',
      label: '빌릴 물품',
      done: !!need.queryText.trim() && need.category !== null,
      optional: false,
      value: need.queryText.trim() || null,
      hint: '어떤 물품이 필요한지 말씀해 주세요',
    },
    {
      key: 'startAt',
      label: '받는 날짜·시간',
      done: !!need.startAt,
      optional: false,
      value: need.startAt ? formatSeoulDateTime(need.startAt) : null,
      hint: '언제부터 쓰실지 알려 주세요',
    },
    {
      key: 'endAt',
      label: '반납 날짜·시간',
      done: !!need.endAt,
      optional: false,
      value: need.endAt ? `${formatSeoulDateTime(need.endAt)}${days ? ` · ${days}일` : ''}` : null,
      hint: `최대 ${RENTAL_POLICY.maxDays}일까지 빌릴 수 있어요`,
    },
    {
      key: 'place',
      label: '받는 장소',
      done: placeLabels.length > 0,
      optional: false,
      value: placeLabels.join(' · ') || null,
      hint: '어디에서 받으실지 알려 주세요',
    },
    {
      key: 'budget',
      label: '예산',
      done: need.maxBudgetKrw !== null,
      optional: true,
      value: need.maxBudgetKrw !== null ? `최대 ${formatKrw(need.maxBudgetKrw)}` : null,
      hint: '선택 · 센터 물품은 무료예요',
    },
  ];
}

export function checklistProgress(items: readonly ChecklistItem[]): number {
  const required = items.filter((item) => !item.optional);
  return required.length ? required.filter((item) => item.done).length / required.length : 0;
}

/** Ready for the approval sheet: the server-equivalent collection rule plus eligibility. */
export function readyForApproval(
  extraction: ExtractNeedResult | null,
  eligible: boolean,
  serverNow: number,
): boolean {
  return !!extraction && eligible && isNeedCollectionComplete(extraction, serverNow);
}
