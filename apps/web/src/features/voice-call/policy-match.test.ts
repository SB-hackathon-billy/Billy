import { afterEach, describe, expect, it, vi } from 'vitest';
import { CENTER_POLICY_IDS, type PolicyMatch } from '@sb/contracts';
import {
  POLICY_MATCH_DEBOUNCE_MS,
  PolicyMatchTracker,
  policyCard,
  policyUtterances,
  selectPolicyCards,
  type PolicyMatchState,
} from './policy-match.js';

const meta = () => ({
  contractVersion: '0.3.0',
  serverTime: new Date().toISOString(),
  traceId: 'trace_test',
});
const ok = (data: PolicyMatch) =>
  new Response(JSON.stringify({ data, meta: meta() }), { status: 200 });
const error = (status: number, code: string) =>
  new Response(
    JSON.stringify({ error: { code, message: code, retryable: true, details: {} }, meta: meta() }),
    { status },
  );
const travel: PolicyMatch = { situation: '여행 준비', policyIds: ['rental-guide', 'club'] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Drives the tracker the way the call screen does and returns the latest state it reported. */
function track(responses: Response[]) {
  vi.useFakeTimers();
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) => responses.shift() ?? error(503, 'AI_UNAVAILABLE'),
  );
  vi.stubGlobal('fetch', fetch);
  let state: PolicyMatchState = { status: 'idle', match: null };
  const tracker = new PolicyMatchTracker(false, (next) => (state = next));
  const say = async (...utterances: string[]) => {
    tracker.update(utterances);
    await vi.advanceTimersByTimeAsync(POLICY_MATCH_DEBOUNCE_MS);
  };
  return { say, tracker, fetch, state: () => state };
}

describe('background policy search during a call', () => {
  it('keeps the earlier match when a later search fails', async () => {
    const call = track([ok(travel), error(503, 'AI_UNAVAILABLE')]);
    await call.say('친구들이랑 여행 가요');
    expect(call.state()).toEqual({ status: 'ready', match: travel });
    await call.say('친구들이랑 여행 가요', '센터에서 받을게요');
    expect(call.state()).toEqual({ status: 'failed', match: travel });
    expect(selectPolicyCards(call.state(), 'gotgan')).toEqual({
      kind: 'matched',
      ...travel,
      policyIds: [travel.policyIds[0]!],
    });
  });
  it('keeps the earlier match when a later search is rate limited', async () => {
    const call = track([ok(travel), error(429, 'RATE_LIMITED')]);
    await call.say('친구들이랑 여행 가요');
    await call.say('친구들이랑 여행 가요', '내일 받을게요');
    expect(selectPolicyCards(call.state(), 'gotgan')).toEqual({
      kind: 'matched',
      ...travel,
      policyIds: [travel.policyIds[0]!],
    });
  });
  it('shows the earlier match while the newest search is still running', async () => {
    const call = track([ok(travel)]);
    await call.say('친구들이랑 여행 가요');
    call.tracker.update(['친구들이랑 여행 가요', '센터에서 받을게요']);
    expect(call.state().status).toBe('pending');
    expect(selectPolicyCards(call.state(), 'gotgan')).toEqual({
      kind: 'matched',
      ...travel,
      policyIds: [travel.policyIds[0]!],
    });
  });
  it('searches only once the utterances settle and adopts only the latest answer', async () => {
    const call = track([ok({ situation: null, policyIds: [] })]);
    call.tracker.update(['여']);
    await vi.advanceTimersByTimeAsync(POLICY_MATCH_DEBOUNCE_MS / 2);
    await call.say('여행 가요');
    expect(call.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(call.fetch.mock.calls[0]![1]!.body))).toEqual({
      utterances: ['여행 가요'],
    });
  });
  it('lets a newer answer with no policy replace the earlier match', async () => {
    const call = track([ok(travel), ok({ situation: null, policyIds: [] })]);
    await call.say('여행 가요');
    await call.say('여행 가요', '아 여행은 취소됐어요');
    expect(selectPolicyCards(call.state(), 'gotgan')).toEqual({
      kind: 'random',
      policyIds: ['gotgan'],
    });
  });
  it('forgets the previous call’s match when a new call starts', async () => {
    const call = track([ok(travel)]);
    await call.say('여행 가요');
    call.tracker.update([]);
    expect(call.state()).toEqual({ status: 'idle', match: null });
  });
  it('uses the keyword rules without server calls in the scripted demo', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let state: PolicyMatchState = { status: 'idle', match: null };
    new PolicyMatchTracker(true, (next) => (state = next)).update(['요즘 너무 외로워요']);
    expect(state.match?.policyIds).toEqual(['mind-check']);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('done-sheet policy cards', () => {
  it('falls back to the call’s random policy when no policy was found', () => {
    const random = { kind: 'random', policyIds: ['gotgan'] };
    // Situation mentioned but no policy fits.
    expect(
      selectPolicyCards(
        { status: 'ready', match: { situation: '결혼식 참석', policyIds: [] } },
        'gotgan',
      ),
    ).toEqual(random);
    expect(selectPolicyCards({ status: 'failed', match: null }, 'gotgan')).toEqual(random);
    expect(selectPolicyCards({ status: 'idle', match: null }, 'gotgan')).toEqual(random);
  });
  it('shows only the best match', () => {
    const ready = {
      status: 'ready' as const,
      match: { situation: 'x', policyIds: ['club', 'gotgan'] as never },
    };
    expect(selectPolicyCards(ready, 'membership')).toEqual({
      kind: 'matched',
      situation: 'x',
      policyIds: ['club'],
    });
  });
  it('waits only when no answer has arrived yet', () => {
    expect(selectPolicyCards({ status: 'pending', match: null }, 'gotgan')).toEqual({
      kind: 'pending',
    });
  });
  it('links every catalog policy to a center guide screen', () => {
    for (const id of CENTER_POLICY_IDS)
      expect(policyCard(id).to).toMatch(/^\/center\/(board|services)\//);
    expect(policyCard('rental-guide').summary).toContain('최대 14일');
  });
});

describe('policy utterances', () => {
  it('keeps the opening and latest caller lines within the server limits', () => {
    const lines = [
      { role: 'assistant', text: '어떤 물건이 필요하세요?' },
      { role: 'user', text: '  ' },
      ...Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: ` 발화 ${i} ` })),
      { role: 'user', text: '가'.repeat(600) },
    ];
    const result = policyUtterances(lines);
    expect(result).toHaveLength(30);
    expect(result.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `발화 ${i}`));
    expect(result[10]).toBe('발화 21');
    expect(result.at(-1)).toHaveLength(500);
  });
});
