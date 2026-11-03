import { expect, it, vi } from 'vitest';
import type { Database, Session } from '@sb/db';
import { ExtractNeedResultSchema } from '@sb/contracts';
import { AI_FIXTURES } from '@sb/ai';
import { collectionComplete, currentVoiceTurn } from './guards.js';
import { proposeVoiceSummary } from './bindings.js';

it('requires real required fields, valid future period and no unanswered clarification', () => {
  const result = ExtractNeedResultSchema.parse(AI_FIXTURES.EXTRACT_NEED.output.result);
  const now = AI_FIXTURES.EXTRACT_NEED.input.serverNow;
  expect(collectionComplete(result, now)).toBe(true);
  result.proposedNeed.maxBudgetKrw = null;
  expect(collectionComplete(result, now)).toBe(true);
  expect(
    collectionComplete({ ...result, clarificationQuestion: '여러 개 중 무엇을 빌릴까요?' }, now),
  ).toBe(false);
  expect(collectionComplete({ ...result, missingFields: ['queryText'] }, now)).toBe(false);
  expect(
    collectionComplete(
      { ...result, proposedNeed: { ...result.proposedNeed, preferredPlaceIds: [] } },
      now,
    ),
  ).toBe(false);
  expect(collectionComplete(result, result.proposedNeed.endAt!)).toBe(false);
});
it('never authorizes a stale, blocked or closed turn', () => {
  const current = { active: true, inputRevision: 2, turnStatus: 'READY' };
  expect(currentVoiceTurn(current, 2)).toBe(true);
  expect(currentVoiceTurn(current, 1)).toBe(false);
  expect(currentVoiceTurn({ ...current, turnStatus: 'BLOCKED' }, 2)).toBe(false);
  expect(currentVoiceTurn({ ...current, active: false }, 2)).toBe(false);
});
it('rechecks scope after asynchronous reads before invoking a proposal', async () => {
  let current = true;
  const session = { id: 'session_a', userId: 'u_hana' } as Session;
  const agentTurn = vi.fn();
  const u = {
    session: async () => session,
    agentTurn,
    getRequest: async () => {
      current = false;
      return { request: { status: 'DRAFT' } };
    },
  };
  const db = {
    transaction: async (fn: (value: typeof u) => Promise<unknown>) => fn(u),
  } as unknown as Database;
  const authority = { id: 'voice_test', requestId: 'req_test', token: 'server-token', session };
  expect(await proposeVoiceSummary(db, authority, '물품', () => current)).toBeNull();
  expect(agentTurn).not.toHaveBeenCalled();
});
