import {
  HeartbeatSchema,
  SseEventSchema,
  SSE_EVENT_TYPE_VALUES,
  SyncDataSchema,
  type SseEvent,
  type SyncData,
} from '@sb/contracts';
import { api, serverClock } from './api.js';
import type { QueryClient } from '@tanstack/react-query';

export class EventGate {
  cursor = '0';
  private requests = new Map<string, number>();
  private negotiations = new Map<string, number>();
  observeRequest(id: string, version: number) {
    this.requests.set(id, Math.max(version, this.requests.get(id) ?? 0));
  }
  observeNegotiation(id: string, version: number) {
    this.negotiations.set(id, Math.max(version, this.negotiations.get(id) ?? 0));
  }
  snapshot(data: SyncData) {
    this.cursor = data.eventCursor;
    data.requestSummaries.forEach((r) => this.observeRequest(r.id, r.version));
    data.ownerCards.forEach((c) =>
      this.observeNegotiation(c.negotiation.id, c.negotiation.version),
    );
  }
  accept(event: SseEvent): boolean {
    if (BigInt(event.eventId) <= BigInt(this.cursor)) return false;
    this.cursor = event.eventId;
    if (event.requestId && event.requestVersion !== undefined) {
      if (event.requestVersion < (this.requests.get(event.requestId) ?? 0)) return false;
      this.observeRequest(event.requestId, event.requestVersion);
    }
    if (event.negotiationId && event.negotiationVersion !== undefined) {
      if (event.negotiationVersion < (this.negotiations.get(event.negotiationId) ?? 0))
        return false;
      this.observeNegotiation(event.negotiationId, event.negotiationVersion);
    }
    return true;
  }
}
export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'offline';

export class RealtimeSync {
  readonly gate = new EventGate();
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReceived = Date.now();
  private lastAttempt = 0;
  private busy = false;
  private stopped = false;
  private generation = 0;
  private abort: AbortController | null = null;
  constructor(
    private query: QueryClient,
    private status: (status: ConnectionStatus) => void,
    private revoked: () => void,
  ) {}
  start() {
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('online', this.foreground);
    window.addEventListener('offline', this.offline);
    this.timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || this.stopped) return;
      if (this.source && Date.now() - this.lastReceived > 30_000) this.fail();
      if (!this.source && Date.now() - this.lastAttempt >= 5_000) void this.resync();
    }, 1_000);
    void this.resync();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    this.source?.close();
    this.source = null;
    this.abort?.abort();
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('online', this.foreground);
    window.removeEventListener('offline', this.offline);
  }
  private visibility = () => {
    if (document.visibilityState === 'visible') this.foreground();
    else {
      this.source?.close();
      this.source = null;
      this.generation++;
      this.abort?.abort();
    }
  };
  private foreground = () => {
    void this.resync();
  };
  private offline = () => {
    this.fail();
    this.status('offline');
  };
  private fail() {
    this.source?.close();
    this.source = null;
    if (!this.stopped) this.status(navigator.onLine ? 'polling' : 'offline');
  }
  async resync() {
    if (this.busy || this.stopped || document.visibilityState !== 'visible') return;
    this.busy = true;
    this.lastAttempt = Date.now();
    this.source?.close();
    this.source = null;
    const generation = ++this.generation;
    this.abort = new AbortController();
    try {
      const snapshot = await api.get('/sync', SyncDataSchema, this.abort.signal);
      if (this.stopped || generation !== this.generation) return;
      this.gate.snapshot(snapshot);
      this.query.setQueryData(['sync'], snapshot);
      await this.query.invalidateQueries({
        predicate: (q) =>
          ['request', 'negotiation', 'payment', 'task'].includes(String(q.queryKey[0])),
      });
      if (this.stopped || generation !== this.generation) return;
      const source = new EventSource(
        `/api/v1/events?after=${encodeURIComponent(this.gate.cursor)}`,
      );
      this.source = source;
      this.lastReceived = Date.now();
      source.onopen = () => {
        if (this.source === source) this.status('live');
      };
      source.onerror = () => {
        if (this.source === source) this.fail();
      };
      for (const type of SSE_EVENT_TYPE_VALUES)
        source.addEventListener(type, (raw) => {
          if (this.stopped || this.source !== source) return;
          this.lastReceived = Date.now();
          try {
            const data: unknown = JSON.parse((raw as MessageEvent<string>).data);
            if (type === 'heartbeat') {
              serverClock.observe(HeartbeatSchema.parse(data).serverTime);
              return;
            }
            const event = SseEventSchema.parse(data);
            if (event.type !== type) {
              this.fail();
              return;
            }
            if (!this.gate.accept(event)) return;
            if (event.type === 'session.revoked') {
              this.stop();
              this.revoked();
              return;
            }
            if (event.type === 'sync.required') {
              void this.resync();
              return;
            }
            void this.query.invalidateQueries({ queryKey: ['sync'] });
            if (event.requestId)
              void this.query.invalidateQueries({ queryKey: ['request', event.requestId] });
            if (event.negotiationId)
              void this.query.invalidateQueries({ queryKey: ['negotiation', event.negotiationId] });
            if (event.taskId)
              void this.query.invalidateQueries({ queryKey: ['task', event.taskId] });
            if (event.type === 'demo_hold.expired')
              void this.query.invalidateQueries({ queryKey: ['payment', event.requestId] });
          } catch {
            this.fail();
          }
        });
    } catch {
      this.fail();
    } finally {
      this.busy = false;
      if (!this.stopped && generation !== this.generation && document.visibilityState === 'visible')
        void this.resync();
    }
  }
}
