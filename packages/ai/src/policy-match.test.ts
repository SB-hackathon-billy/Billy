import { describe, expect, it } from 'vitest';
import { createPolicyMatcher, parsePolicyMatchOutput } from './policy-match.js';

describe('policy match model output', () => {
  it('drops duplicates, caps at three and trims the situation', () => {
    expect(
      parsePolicyMatchOutput(
        JSON.stringify({
          situation: `  ${'긴 상황 설명'.repeat(10)}  `,
          policyIds: ['club', 'club', 'gotgan', 'membership', 'mind-check'],
        }),
      ),
    ).toEqual({
      situation: '긴 상황 설명'.repeat(10).slice(0, 30).trim(),
      policyIds: ['club', 'gotgan', 'membership'],
    });
  });
  it('rejects policies outside the catalog and non-JSON output', () => {
    expect(() =>
      parsePolicyMatchOutput(JSON.stringify({ situation: null, policyIds: ['approve-all'] })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_OUTPUT' }));
    expect(() => parsePolicyMatchOutput('not json')).toThrow(
      expect.objectContaining({ code: 'INVALID_JSON' }),
    );
  });
  it('uses the keyword rules in fixture mode', async () => {
    const match = createPolicyMatcher({ AI_MODE: 'fixture' });
    expect(await match(['요즘 너무 외로워서요'])).toEqual({
      situation: '몸과 마음 돌봄',
      policyIds: ['mind-check'],
    });
  });
});
