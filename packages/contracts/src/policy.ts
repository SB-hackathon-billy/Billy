// 통화 접수 신청완료 화면의 상황별 정책 안내. 명세: docs/specs/0005-call-policy-guidance.md
// 카드에 보이는 제목·요약·링크는 웹의 센터 안내 자료(center-board/posts.ts)가 원본이다.
// 여기에는 매칭에 필요한 ID·상황 설명·키워드만 둔다.
import { z } from 'zod';

export const CENTER_POLICY_IDS = [
  'rental-guide',
  'mind-check',
  'gotgan',
  'club',
  'membership',
] as const;
export const CenterPolicyIdSchema = z.enum(CENTER_POLICY_IDS);
export type CenterPolicyId = z.infer<typeof CenterPolicyIdSchema>;
export const MAX_MATCHED_POLICIES = 3;

export interface CenterPolicyRule {
  /** What the policy offers, for the model prompt. */
  offer: string;
  /** Situations that make it relevant, for the model prompt. */
  situations: string;
  /** Situation summary when the keyword matcher picks this policy first. */
  label: string;
  /** Substrings matched against utterances with whitespace removed. */
  keywords: readonly string[];
}

export const CENTER_POLICIES: Readonly<Record<CenterPolicyId, CenterPolicyRule>> = Object.freeze({
  'rental-guide': {
    offer: '물품대여 이용 규정: 1회 7일, 예약자가 없으면 1회 연장(최대 14일), 물품별 1개·최대 2개',
    situations: '여행·출장·휴가처럼 오래 쓰거나, 물건을 여러 개 함께 빌려야 하는 상황',
    label: '여행·오래 쓰기',
    keywords: [
      '여행',
      '출장',
      '휴가',
      '한달',
      '오래',
      '연장',
      '장기',
      '두개',
      '여러개',
      '이것저것',
    ],
  },
  'mind-check': {
    offer: '마음점검: 성격검사 기반 2회기 심리지원 상담',
    situations: '외로움·우울·스트레스·불면, 이별, 혼자 아프거나 회복 중인 상황',
    label: '몸과 마음 돌봄',
    keywords: [
      '외로',
      '우울',
      '스트레스',
      '힘들',
      '지쳐',
      '지치',
      '불면',
      '잠이안',
      '잠을못',
      '이별',
      '헤어졌',
      '상담',
      '몸살',
      '아프',
      '아픈',
      '아파서',
      '아파요',
      '감기',
      '입원',
      '퇴원',
      '수술',
      '회복',
    ],
  },
  gotgan: {
    offer: '성북곳간: 1인가구 공유주방과 소셜다이닝',
    situations: '요리·식사·혼밥, 집들이·파티·손님 초대, 명절·생일을 혼자 보내는 상황',
    label: '요리·식사 모임',
    keywords: [
      '요리',
      '음식',
      '식사',
      '혼밥',
      '밥',
      '집들이',
      '파티',
      '손님',
      '명절',
      '설날',
      '추석',
      '생일',
    ],
  },
  club: {
    offer: '1인가구 동아리 지원: 관심사가 같은 3~6명 팀 활동 지원',
    situations: '취미·운동·캠핑·사진처럼 여럿이 함께하는 활동이나 모임',
    label: '취미·모임',
    keywords: [
      '취미',
      '동호회',
      '동아리',
      '모임',
      '사진',
      '운동',
      '등산',
      '캠핑',
      '친구들',
      '같이할',
      '함께할',
      '배우고',
    ],
  },
  membership: {
    offer: '센터 회원가입·정회원 인증: 센터 프로그램 이용 자격',
    situations: '이사·전입·자취 시작·독립처럼 성북구에서 새 생활을 시작하는 상황',
    label: '새 생활 시작',
    keywords: ['이사', '전입', '자취', '혼자살', '독립', '새집', '입주'],
  },
});

export const PolicyMatchBodySchema = z
  .object({
    utterances: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict();
export type PolicyMatchBody = z.infer<typeof PolicyMatchBodySchema>;

export const PolicyMatchSchema = z
  .object({
    /** The rental situation found in the utterances, or null when none was mentioned. */
    situation: z.string().trim().min(1).max(30).nullable(),
    /** Relevant policies, most relevant first. Empty means "show a random policy". */
    policyIds: z
      .array(CenterPolicyIdSchema)
      .max(MAX_MATCHED_POLICIES)
      .refine((ids) => new Set(ids).size === ids.length, '중복 정책'),
  })
  .strict();
export type PolicyMatch = z.infer<typeof PolicyMatchSchema>;

/** Deterministic matcher for fixture mode and the scripted demo. Ranks by keyword hits. */
export function matchPoliciesByKeyword(utterances: readonly string[]): PolicyMatch {
  const text = utterances.join(' ').replace(/\s+/g, '');
  const ranked = CENTER_POLICY_IDS.map((id, order) => ({
    id,
    order,
    hits: CENTER_POLICIES[id].keywords.filter((keyword) => text.includes(keyword)).length,
  }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .slice(0, MAX_MATCHED_POLICIES);
  const top = ranked[0];
  return {
    situation: top ? CENTER_POLICIES[top.id].label : null,
    policyIds: ranked.map((entry) => entry.id),
  };
}

/** One policy for calls with no matched situation. `random` returns [0, 1). */
export function pickRandomPolicy(random: () => number = Math.random): CenterPolicyId {
  const index = Math.min(
    CENTER_POLICY_IDS.length - 1,
    Math.floor(random() * CENTER_POLICY_IDS.length),
  );
  return CENTER_POLICY_IDS[index]!;
}
