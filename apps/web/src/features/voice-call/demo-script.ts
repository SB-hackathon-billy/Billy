// 시연 스크립트(`/rental?demo=script`). 실제 음성 연결·서버 호출 없이 통화 화면의 상태 변화를 재생한다.
// 화면에 "시연 스크립트"가 표시되며 예약 신청도 보내지 않는다.
import type { ExtractNeedResult, NeedDraft, VoiceStatus } from '@sb/contracts';

export type ScriptStep =
  | { at: number; kind: 'status'; status: VoiceStatus }
  | { at: number; kind: 'line'; role: 'user' | 'assistant'; text: string }
  | { at: number; kind: 'thinking' }
  | { at: number; kind: 'proposal'; result: ExtractNeedResult };

const HALF_HOUR = 1_800_000;
/** Tomorrow-or-later 10:00 Asia/Seoul, as the server would extract "내일 오전 열 시". */
function tomorrowAtTen(now: number) {
  const seoul = new Date(now + 9 * 3_600_000);
  const day = Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate() + 1);
  const start = day + 1 * 3_600_000; // 10:00 KST = 01:00 UTC
  return Math.ceil(start / HALF_HOUR) * HALF_HOUR;
}

export function buildDemoScript(now: number, placeId: string): ScriptStep[] {
  const start = tomorrowAtTen(now);
  const end = start + 3 * 86_400_000;
  const base: NeedDraft = {
    category: null,
    queryText: '',
    startAt: null,
    endAt: null,
    preferredPlaceIds: [],
    maxBudgetKrw: null,
  };
  const step1: NeedDraft = { ...base, category: 'TRAVEL', queryText: '캐리어' };
  const step2: NeedDraft = {
    ...step1,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  };
  const step3: NeedDraft = { ...step2, preferredPlaceIds: [placeId] };
  return [
    { at: 0, kind: 'status', status: 'CONNECTING' },
    { at: 900, kind: 'status', status: 'SPEAKING' },
    {
      at: 1000,
      kind: 'line',
      role: 'assistant',
      text: '안녕하세요, 성북 공유대여 상담 도우미예요. 어떤 물건이 필요하세요?',
    },
    { at: 3200, kind: 'status', status: 'LISTENING' },
    {
      at: 3600,
      kind: 'line',
      role: 'user',
      text: '다음 주 제주도 여행 가는데 캐리어 빌릴 수 있을까요?',
    },
    { at: 5200, kind: 'thinking' },
    {
      at: 6600,
      kind: 'proposal',
      result: {
        proposedNeed: step1,
        missingFields: ['startAt', 'endAt', 'preferredPlaceIds'],
        clarificationQuestion: '언제부터 언제까지 쓰실 예정인가요?',
      },
    },
    { at: 6800, kind: 'status', status: 'SPEAKING' },
    {
      at: 6900,
      kind: 'line',
      role: 'assistant',
      text: '캐리어요! 언제부터 언제까지 쓰실 예정인가요?',
    },
    { at: 8600, kind: 'status', status: 'LISTENING' },
    {
      at: 9000,
      kind: 'line',
      role: 'user',
      text: '내일 오전 열 시에 받아서 사흘 쓰고 돌려드릴게요.',
    },
    { at: 10400, kind: 'thinking' },
    {
      at: 11800,
      kind: 'proposal',
      result: {
        proposedNeed: step2,
        missingFields: ['preferredPlaceIds'],
        clarificationQuestion: '어디에서 받으시겠어요?',
      },
    },
    { at: 12000, kind: 'status', status: 'SPEAKING' },
    {
      at: 12100,
      kind: 'line',
      role: 'assistant',
      text: '좋아요. 물건은 어디에서 받으시겠어요? 센터 1층에서 받을 수 있어요.',
    },
    { at: 14200, kind: 'status', status: 'LISTENING' },
    { at: 14600, kind: 'line', role: 'user', text: '센터에서 받을게요.' },
    { at: 15600, kind: 'thinking' },
    {
      at: 17000,
      kind: 'proposal',
      result: { proposedNeed: step3, missingFields: [], clarificationQuestion: null },
    },
    { at: 17200, kind: 'status', status: 'SPEAKING' },
    {
      at: 17300,
      kind: 'line',
      role: 'assistant',
      text: '필요한 내용을 모두 정리했어요. 화면의 신청 내용을 확인하고 최종 승인을 눌러 주세요.',
    },
    { at: 20000, kind: 'status', status: 'LISTENING' },
  ];
}
