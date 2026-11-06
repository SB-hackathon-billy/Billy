// 통화 중 사용자 발화로 관련 센터 정책을 백그라운드에서 찾는다. 명세: docs/specs/0005-call-policy-guidance.md
// 통화 화면에는 표시하지 않고, 신청완료 시트에서만 카드로 보여준다.
import { useEffect, useRef, useState } from 'react';
import {
  PolicyMatchSchema,
  matchPoliciesByKeyword,
  type CenterPolicyId,
  type PolicyMatch,
} from '@sb/contracts';
import { CommandIntent, api } from '../../lib/api.js';
import { centerPosts, centerServices, type Artwork } from '../center-board/posts.js';

/** Utterances must stop changing this long before the policy search runs. */
export const POLICY_MATCH_DEBOUNCE_MS = 1_200;
const MAX_UTTERANCES = 30;
/** Situations usually come up first, so clamping keeps the opening lines plus the latest ones. */
const OPENING_UTTERANCES = 10;
const MAX_UTTERANCE_CHARS = 500;

/**
 * `match` is the latest answer received during this call. While a newer search is pending or after
 * it failed (rate limit, AI timeout, network), the earlier answer stays.
 */
export interface PolicyMatchState {
  status: 'idle' | 'pending' | 'ready' | 'failed';
  match: PolicyMatch | null;
}

/** The request body for a call's user lines, within the server's limits. */
export function policyUtterances(lines: readonly { role: string; text: string }[]): string[] {
  const all = lines
    .filter((line) => line.role === 'user')
    .map((line) => line.text.trim().slice(0, MAX_UTTERANCE_CHARS).trim())
    .filter(Boolean);
  return all.length > MAX_UTTERANCES
    ? [...all.slice(0, OPENING_UTTERANCES), ...all.slice(OPENING_UTTERANCES - MAX_UTTERANCES)]
    : all;
}

/**
 * Searches policies for the latest utterances in the background. Only the answer for the latest
 * utterances is adopted; empty utterances (a new call) clear everything. The scripted demo makes no
 * server calls and uses the same keyword rules as the server's fixture mode.
 */
export class PolicyMatchTracker {
  private state: PolicyMatchState = { status: 'idle', match: null };
  private key = '[]';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(
    private readonly scripted: boolean,
    private readonly onChange: (state: PolicyMatchState) => void,
  ) {}

  update(utterances: readonly string[]) {
    const key = JSON.stringify(utterances);
    if (key === this.key) return;
    this.key = key;
    this.cancel();
    if (!utterances.length) return this.set({ status: 'idle', match: null });
    if (this.scripted)
      return this.set({ status: 'ready', match: matchPoliciesByKeyword(utterances) });
    this.set({ status: 'pending', match: this.state.match });
    const generation = this.generation;
    const body = { utterances: [...utterances] };
    this.timer = setTimeout(() => {
      api
        .execute(new CommandIntent('/policy-matches', 'POST', body), PolicyMatchSchema)
        .then((match) => generation === this.generation && this.set({ status: 'ready', match }))
        .catch(
          () =>
            generation === this.generation &&
            this.set({ status: 'failed', match: this.state.match }),
        );
    }, POLICY_MATCH_DEBOUNCE_MS);
  }

  dispose() {
    this.cancel();
  }

  private cancel() {
    this.generation++;
    clearTimeout(this.timer);
  }

  private set(state: PolicyMatchState) {
    this.state = state;
    this.onChange(state);
  }
}

export function usePolicyMatch(utterances: readonly string[], scripted: boolean): PolicyMatchState {
  const [state, setState] = useState<PolicyMatchState>({ status: 'idle', match: null });
  const tracker = useRef<PolicyMatchTracker | null>(null);
  useEffect(() => {
    const created = new PolicyMatchTracker(scripted, setState);
    tracker.current = created;
    return () => created.dispose();
  }, [scripted]);
  useEffect(() => tracker.current?.update(utterances), [utterances, scripted]);
  return state;
}

export type PolicyCardSelection =
  | { kind: 'pending' }
  | { kind: 'matched'; situation: string | null; policyIds: CenterPolicyId[] }
  | { kind: 'random'; policyIds: [CenterPolicyId] };

/**
 * The latest answer's policies when it found any, even while a newer search is pending or after it
 * failed; otherwise (no situation mentioned, no matching policy, no answer, no utterances) the
 * call's random policy. Waits only when no answer has arrived yet.
 */
export function selectPolicyCards(
  state: PolicyMatchState,
  randomPolicy: CenterPolicyId,
): PolicyCardSelection {
  if (state.status === 'pending' && !state.match) return { kind: 'pending' };
  if (state.match?.policyIds.length)
    return { kind: 'matched', situation: state.match.situation, policyIds: state.match.policyIds };
  return { kind: 'random', policyIds: [randomPolicy] };
}

export interface PolicyCard {
  id: CenterPolicyId;
  title: string;
  summary: string;
  artwork: Artwork;
  to: string;
}

/** Card content comes from the center guide data; the rental card shows its period/quantity rules. */
export function policyCard(id: CenterPolicyId): PolicyCard {
  if (id === 'rental-guide') {
    const post = centerPosts.find((p) => p.id === id)!;
    const rules = post.facts.filter(([name]) => name === '기간' || name === '수량');
    return {
      id,
      title: post.title,
      summary: rules.map(([, value]) => value).join(' · ') || post.summary,
      artwork: post.artwork,
      to: `/center/board/${id}`,
    };
  }
  const service = centerServices.find((s) => s.id === id)!;
  return {
    id,
    title: service.title,
    summary: service.summary,
    artwork: service.artwork,
    to: `/center/services/${id}`,
  };
}
