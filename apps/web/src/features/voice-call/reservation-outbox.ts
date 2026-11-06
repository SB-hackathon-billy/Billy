// 승인된 예약 신청 도구 호출의 백그라운드 재시도. 명세: docs/specs/0003-voice-call-reservation.md
// 통화는 결과와 무관하게 종료되고, 실패한 호출은 이 대기열이 앱이 열려 있는 동안(재시작 후 포함) 다시 보낸다.
// 서버는 요청당 1건만 만들므로 응답을 잃은 뒤의 재전송도 같은 도구 실행을 돌려준다.
import {
  INTAKE_APPROVAL_MAX_ATTEMPTS,
  IntakeApprovalSchema,
  RequestViewSchema,
  type IntakeApproval,
} from '@sb/contracts';
import { ActionScope, ApiError, api, idPath } from '../../lib/api.js';

export interface OutboxEntry {
  requestId: string;
  extractionTaskId: string;
  voiceSessionId: string | null;
  attempts: number;
  nextAt: number;
}
/** final: 재시도를 멈췄다(재시도할 수 없는 응답이거나 횟수 상한). 명세 0004. */
type Listener = (
  requestId: string,
  result: IntakeApproval | null,
  error: unknown,
  final: boolean,
) => void;
export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'sb-intake-approval-outbox-v1';
export const retryDelayMs = (attempts: number) =>
  Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
// 연결·일시 장애와 최신 버전 재조회로 풀리는 충돌만 다시 보낸다. 그 밖의 4xx는 같은 본문으로 다시 보내도 같다.
const RETRYABLE = new Set([
  'NETWORK',
  'PROTOCOL',
  'TEMPORARILY_UNAVAILABLE',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'CSRF_REJECTED',
  'SESSION_EXPIRED',
  'VERSION_CONFLICT',
]);
export const isRetryable = (error: unknown) =>
  !(error instanceof ApiError) || RETRYABLE.has(error.code);

export class ReservationOutbox {
  private entries = new Map<string, OutboxEntry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = new Set<string>();
  private scopes = new Map<string, ActionScope>();
  private listeners = new Set<Listener>();
  private loaded = false;

  constructor(
    private readonly storage: () => OutboxStorage | null = () => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    },
    private readonly clock: () => number = Date.now,
  ) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  pending(requestId: string) {
    this.load();
    return this.entries.get(requestId) ?? null;
  }

  /** First tool call. Resolves with the server result, or rejects after queueing a retry. */
  async submit(entry: Omit<OutboxEntry, 'attempts' | 'nextAt'>): Promise<IntakeApproval> {
    this.load();
    const queued = { ...entry, attempts: 0, nextAt: this.clock() };
    this.entries.set(entry.requestId, queued);
    this.persist();
    return this.attempt(queued, true) as Promise<IntakeApproval>;
  }

  /** Resume queued calls after a reload. */
  resume() {
    this.load();
    this.schedule();
  }

  /** Session end: another person may use this browser next. */
  clear() {
    this.entries.clear();
    this.scopes.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.storage()?.removeItem(KEY);
  }

  private async attempt(entry: OutboxEntry, rethrow = false): Promise<IntakeApproval | null> {
    if (this.inFlight.has(entry.requestId)) return null;
    this.inFlight.add(entry.requestId);
    try {
      const latest = await api.get(`/requests/${idPath(entry.requestId)}`, RequestViewSchema);
      const body = {
        requestId: entry.requestId,
        extractionTaskId: entry.extractionTaskId,
        expectedRequestVersion: latest.request.version,
        ...(entry.voiceSessionId ? { voiceSessionId: entry.voiceSessionId } : {}),
      };
      // Same body → same Idempotency-Key, so a lost response is replayed rather than re-executed.
      const scope = this.scopes.get(entry.requestId) ?? new ActionScope();
      this.scopes.set(entry.requestId, scope);
      const result = await api.execute(
        scope.command('/intake-approvals', 'POST', body),
        IntakeApprovalSchema,
      );
      this.entries.delete(entry.requestId);
      this.scopes.delete(entry.requestId);
      this.persist();
      this.emit(entry.requestId, result, null, true);
      return result;
    } catch (error) {
      const current = this.entries.get(entry.requestId);
      let final = false;
      if (current) {
        current.attempts++;
        final = !isRetryable(error) || current.attempts >= INTAKE_APPROVAL_MAX_ATTEMPTS;
        if (final) {
          this.entries.delete(entry.requestId);
          this.scopes.delete(entry.requestId);
        } else current.nextAt = this.clock() + retryDelayMs(current.attempts);
        this.persist();
      }
      this.emit(entry.requestId, null, error, final);
      if (rethrow) throw error;
      return null;
    } finally {
      this.inFlight.delete(entry.requestId);
      this.schedule();
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = [...this.entries.values()].sort((a, b) => a.nextAt - b.nextAt)[0];
    if (!next) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        const due = [...this.entries.values()].filter((e) => e.nextAt <= this.clock());
        for (const entry of due) void this.attempt(entry);
        if (!due.length) this.schedule();
      },
      Math.max(0, next.nextAt - this.clock()),
    );
  }

  private emit(requestId: string, result: IntakeApproval | null, error: unknown, final: boolean) {
    for (const listener of this.listeners) listener(requestId, result, error, final);
  }
  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.storage()?.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
      for (const entry of parsed)
        if (
          entry &&
          typeof entry.requestId === 'string' &&
          typeof entry.extractionTaskId === 'string'
        )
          this.entries.set(entry.requestId, entry);
    } catch {
      /* Corrupt storage is ignored; the server keeps any job that was created. */
    }
  }
  private persist() {
    try {
      const storage = this.storage();
      if (!storage) return;
      if (this.entries.size) storage.setItem(KEY, JSON.stringify([...this.entries.values()]));
      else storage.removeItem(KEY);
    } catch {
      /* Storage may be unavailable (private mode); the in-memory queue still retries. */
    }
  }
}

export const reservationOutbox = new ReservationOutbox();
export const hasQueuedReservations = () => {
  try {
    return !!window.localStorage.getItem(KEY);
  } catch {
    return false;
  }
};
