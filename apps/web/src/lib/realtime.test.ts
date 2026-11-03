import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { SseEvent, SyncData } from '@sb/contracts';
import { api } from './api.js';
import { EventGate, RealtimeSync } from './realtime.js';

const event = (eventId: string, fields: Partial<SseEvent> = {}): SseEvent => ({
  eventId,
  eventVersion: 1,
  type: 'request.updated',
  occurredAt: '2026-11-01T01:00:00Z',
  requestId: 'req_one',
  requestVersion: 2,
  ...fields,
});
const snapshot: SyncData = { requestSummaries: [], ownerCards: [], tasks: [], eventCursor: '30' };
describe('event ordering', () => {
  it('drops duplicate and out-of-order cursors including integers above Number.MAX_SAFE_INTEGER', () => {
    const gate = new EventGate();
    expect(gate.accept(event('9007199254740993'))).toBe(true);
    expect(gate.accept(event('9007199254740993'))).toBe(false);
    expect(gate.accept(event('9007199254740992'))).toBe(false);
    expect(gate.accept(event('9007199254740994'))).toBe(true);
  });
  it('does not regress a request that was already observed by REST', () => {
    const gate = new EventGate();
    gate.observeRequest('req_one', 8);
    expect(gate.accept(event('1', { requestVersion: 7 }))).toBe(false);
    expect(gate.accept(event('2', { requestVersion: 8 }))).toBe(true);
    expect(gate.accept(event('3', { requestVersion: 9 }))).toBe(true);
  });
  it('checks an owner branch version independently without requiring a root version', () => {
    const gate = new EventGate();
    gate.observeNegotiation('neg_one', 4);
    const base = { type: 'negotiation.updated' as const, negotiationId: 'neg_one' };
    const old: SseEvent = {
      eventId: '1',
      eventVersion: 1,
      occurredAt: '2026-11-01T01:00:00Z',
      ...base,
      negotiationVersion: 3,
    };
    expect(gate.accept(old)).toBe(false);
    expect(gate.accept({ ...old, eventId: '2', negotiationVersion: 5 })).toBe(true);
  });
  it('starts after the snapshot cursor and permits task updates at equal request versions', () => {
    const gate = new EventGate();
    gate.snapshot(snapshot);
    expect(gate.accept(event('29'))).toBe(false);
    gate.observeRequest('req_one', 9);
    expect(
      gate.accept(
        event('31', { type: 'agent.task.updated', taskId: 'task_one', requestVersion: 9 }),
      ),
    ).toBe(true);
  });
});
class Source extends EventTarget {
  static sources: Source[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    Source.sources.push(this);
  }
  close() {
    this.closed = true;
  }
  send(type: string, data: unknown) {
    const message = new Event(type);
    Object.assign(message, { data: JSON.stringify(data) });
    this.dispatchEvent(message);
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Source.sources = [];
});
describe('sync lifecycle', () => {
  function setup() {
    vi.useFakeTimers();
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const window = new EventTarget();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('EventSource', Source);
    const get = vi.spyOn(api, 'get').mockResolvedValue(snapshot);
    const status = vi.fn();
    const revoked = vi.fn();
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sync = new RealtimeSync(query, status, revoked);
    return { document, window, get, status, revoked, query, sync };
  }
  it('synchronizes before opening SSE and restarts after 30 seconds without heartbeat', async () => {
    const { sync, get } = setup();
    sync.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(Source.sources[0]?.url).toBe('/api/v1/events?after=30');
    expect(get).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(Source.sources[0]?.closed).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    sync.stop();
  });
  it('uses five-second foreground retries, stops in background, and fully syncs on return', async () => {
    const { sync, get, document } = setup();
    sync.start();
    await vi.advanceTimersByTimeAsync(1);
    Source.sources[0]?.onerror?.();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).toHaveBeenCalledTimes(2);
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(get).toHaveBeenCalledTimes(2);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1);
    expect(get).toHaveBeenCalledTimes(3);
    sync.stop();
  });
  it('treats heartbeat as liveness without moving the business cursor and closes on revocation', async () => {
    const { sync, revoked } = setup();
    sync.start();
    await vi.advanceTimersByTimeAsync(1);
    const source = Source.sources[0]!;
    await vi.advanceTimersByTimeAsync(20_000);
    source.send('heartbeat', { serverTime: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(source.closed).toBe(false);
    expect(sync.gate.cursor).toBe('30');
    source.send('session.revoked', event('31', { type: 'session.revoked' }));
    expect(source.closed).toBe(true);
    expect(revoked).toHaveBeenCalledOnce();
    sync.stop();
  });
});
