import { describe, expect, it } from 'vitest';
import {
  CENTER_POLICY_IDS,
  PolicyMatchBodySchema,
  PolicyMatchSchema,
  matchPoliciesByKeyword,
  pickRandomPolicy,
} from './policy.js';

describe('keyword policy matcher', () => {
  it('ranks policies by the situations mentioned across utterances', () => {
    expect(
      matchPoliciesByKeyword([
        '다음 주에 친구들이랑 제주도 여행 가는데',
        '캐리어 빌릴 수 있을까요? 캠핑도 하고 사진도 찍을 거예요',
      ]),
    ).toEqual({ situation: '취미·모임', policyIds: ['club', 'rental-guide'] });
  });
  it('ignores spacing differences inside a phrase', () => {
    expect(matchPoliciesByKeyword(['이번에 혼자 살게 돼서 청소기가 필요해요']).policyIds).toEqual([
      'membership',
    ]);
  });
  it('returns no policy when only the item, period and place are given', () => {
    expect(matchPoliciesByKeyword(['내일 오전 열 시에 프로젝터 받아서 센터에서 받을게요'])).toEqual(
      { situation: null, policyIds: [] },
    );
  });
  it('does not read an apartment or a hair dryer as illness or a breakup', () => {
    expect(
      matchPoliciesByKeyword(['아파트 앞에서 헤어드라이기 받을 수 있을까요']).policyIds,
    ).toEqual([]);
  });
  it('caps the result at three policies', () => {
    const all = matchPoliciesByKeyword(['이사 와서 우울한데 요리 모임 취미 여행']);
    expect(all.policyIds).toHaveLength(3);
  });
});

describe('policy match contract', () => {
  it('rejects duplicate or unknown policies and empty utterance lists', () => {
    expect(
      PolicyMatchSchema.safeParse({ situation: null, policyIds: ['club', 'club'] }).success,
    ).toBe(false);
    expect(PolicyMatchSchema.safeParse({ situation: null, policyIds: ['payments'] }).success).toBe(
      false,
    );
    expect(PolicyMatchBodySchema.safeParse({ utterances: [] }).success).toBe(false);
    expect(PolicyMatchBodySchema.safeParse({ utterances: ['   '] }).success).toBe(false);
  });
  it('picks a random policy across the whole catalog', () => {
    expect(pickRandomPolicy(() => 0)).toBe(CENTER_POLICY_IDS[0]);
    expect(pickRandomPolicy(() => 0.999999)).toBe(CENTER_POLICY_IDS.at(-1));
  });
});
