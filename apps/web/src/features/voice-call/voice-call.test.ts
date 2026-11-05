import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNeed, type ExtractNeedResult, type Place } from '@sb/contracts';
import { CharacterState, deriveCharacterState } from './character.js';
import { buildChecklist, checklistProgress, readyForApproval } from './checklist.js';
import { ReservationOutbox, retryDelayMs, type OutboxStorage } from './reservation-outbox.js';
import { buildDemoScript } from './demo-script.js';

const places: Place[] = [
  { id: 'place-center', label: '센터 앞', description: '데모', isDemo: true },
];
const start = Math.ceil((Date.now() + 86_400_000) / 1_800_000) * 1_800_000;
const complete = (): ExtractNeedResult => ({
  proposedNeed: {
    category: 'TRAVEL',
    queryText: '캐리어',
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 2 * 86_400_000).toISOString(),
    preferredPlaceIds: ['place-center'],
    maxBudgetKrw: null,
  },
  missingFields: [],
  clarificationQuestion: null,
});
const meta = () => ({
  contractVersion: '0.3.0',
  serverTime: new Date().toISOString(),
  traceId: 'trace_test',
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('intake checklist', () => {
  it('checks items one by one as the call records them; budget stays optional', () => {
    const empty = buildChecklist(createEmptyNeed(), places, true);
    expect(empty.map((i) => [i.key, i.done])).toEqual([
      ['eligibility', true],
      ['item', false],
      ['startAt', false],
      ['endAt', false],
      ['place', false],
      ['budget', false],
    ]);
    expect(checklistProgress(empty)).toBeCloseTo(1 / 5);
    const full = buildChecklist(complete().proposedNeed, places, true);
    expect(full.filter((i) => !i.optional).every((i) => i.done)).toBe(true);
    expect(full.find((i) => i.key === 'endAt')!.value).toContain('2일');
    expect(full.find((i) => i.key === 'place')!.value).toBe('센터 앞');
    expect(checklistProgress(full)).toBe(1);
  });

  it('opens the approval sheet only for a complete, question-free, eligible collection', () => {
    expect(readyForApproval(complete(), true, Date.now())).toBe(true);
    expect(readyForApproval(complete(), false, Date.now())).toBe(false);
    expect(
      readyForApproval({ ...complete(), clarificationQuestion: '맞나요?' }, true, Date.now()),
    ).toBe(false);
    expect(readyForApproval({ ...complete(), missingFields: ['endAt'] }, true, Date.now())).toBe(
      false,
    );
    // Start already passed → invalid period, same as the server guard.
    expect(readyForApproval(complete(), true, start + 1)).toBe(false);
    expect(readyForApproval(null, true, Date.now())).toBe(false);
  });

  it('demo script ends in a collection the approval rule accepts', () => {
    const steps = buildDemoScript(Date.now(), 'place-center');
    const last = steps.filter((s) => s.kind === 'proposal').at(-1);
    expect(last?.kind === 'proposal' && readyForApproval(last.result, true, Date.now())).toBe(true);
  });
});

describe('character state', () => {
  const base = {
    voice: 'LISTENING' as const,
    phase: 'collecting' as const,
    thinking: false,
    userSpoke: true,
  };
  it('follows the call and the approval phase', () => {
    expect(deriveCharacterState({ ...base, voice: 'IDLE' })).toBe(CharacterState.IDLE);
    expect(deriveCharacterState({ ...base, voice: 'CONNECTING' })).toBe(CharacterState.CONNECTING);
    expect(deriveCharacterState({ ...base, voice: 'SPEAKING', userSpoke: false })).toBe(
      CharacterState.GREETING,
    );
    expect(deriveCharacterState({ ...base, voice: 'SPEAKING' })).toBe(CharacterState.SPEAKING);
    expect(deriveCharacterState(base)).toBe(CharacterState.LISTENING);
    expect(deriveCharacterState({ ...base, thinking: true })).toBe(CharacterState.THINKING);
    expect(deriveCharacterState({ ...base, voice: 'RECONNECT_REQUIRED' })).toBe(
      CharacterState.ERROR,
    );
    expect(deriveCharacterState({ ...base, phase: 'review' })).toBe(
      CharacterState.WAITING_APPROVAL,
    );
    expect(deriveCharacterState({ ...base, phase: 'reserving', voice: 'CLOSED' })).toBe(
      CharacterState.RESERVING,
    );
    expect(deriveCharacterState({ ...base, phase: 'done', voice: 'CLOSED' })).toBe(
      CharacterState.DONE,
    );
    expect(deriveCharacterState({ ...base, phase: 'retrying', voice: 'CLOSED' })).toBe(
      CharacterState.RETRYING,
    );
  });
});

describe('reservation outbox', () => {
  const memory = (): OutboxStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };
  const view = (version: number) => ({
    request: {
      id: 'req_1',
      requesterId: 'u_hana',
      version,
      needRevision: 1,
      status: 'DRAFT',
      need: createEmptyNeed(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      selectedNegotiationId: null,
    },
    candidates: [],
    negotiations: [],
    comparison: [],
    tasks: [],
    allowedActions: [],
  });
  const job = () => ({
    id: 'iap_1',
    requestId: 'req_1',
    requesterId: 'u_hana',
    voiceSessionId: null,
    extractionTaskId: 'task_1',
    tool: 'request_reservation',
    status: 'SEARCHING',
    step: 'SUBMIT',
    need: complete().proposedNeed,
    attempts: 0,
    lastErrorCode: null,
    nextAttemptAt: null,
    negotiationIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('queues a failed tool call, persists it, and retries with backoff until it succeeds', async () => {
    vi.useFakeTimers();
    const storage = memory();
    const posts: { key: string | null; body: unknown }[] = [];
    let failures = 2;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'GET') {
          return new Response(JSON.stringify({ data: view(3), meta: meta() }), { status: 200 });
        }
        posts.push({
          key: new Headers(init.headers).get('Idempotency-Key'),
          body: JSON.parse(String(init.body)),
        });
        if (failures-- > 0) throw new TypeError('network down');
        expect(url).toBe('/api/v1/intake-approvals');
        return new Response(JSON.stringify({ data: job(), meta: meta() }), { status: 202 });
      }),
    );
    const outbox = new ReservationOutbox(() => storage);
    const results: unknown[] = [];
    outbox.subscribe((_id, result) => result && results.push(result));
    await expect(
      outbox.submit({ requestId: 'req_1', extractionTaskId: 'task_1', voiceSessionId: null }),
    ).rejects.toThrow();
    expect(storage.data.size).toBe(1);
    expect(outbox.pending('req_1')?.attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    expect(outbox.pending('req_1')?.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(retryDelayMs(2));
    expect(results).toHaveLength(1);
    expect(outbox.pending('req_1')).toBeNull();
    expect(storage.data.size).toBe(0);
    // Same body every time → the same Idempotency-Key is replayed.
    expect(new Set(posts.map((p) => p.key)).size).toBe(1);
    expect(posts[0]!.body).toEqual({
      requestId: 'req_1',
      extractionTaskId: 'task_1',
      expectedRequestVersion: 3,
    });
  });

  it('resumes entries saved by a previous page load and clears on session end', () => {
    const storage = memory();
    storage.setItem(
      'sb-intake-approval-outbox-v1',
      JSON.stringify([
        {
          requestId: 'req_9',
          extractionTaskId: 'task_9',
          voiceSessionId: null,
          attempts: 3,
          nextAt: 0,
        },
      ]),
    );
    const outbox = new ReservationOutbox(() => storage);
    expect(outbox.pending('req_9')?.attempts).toBe(3);
    outbox.clear();
    expect(outbox.pending('req_9')).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});
