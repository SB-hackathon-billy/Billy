import { z } from 'zod';
import * as C from '@sb/contracts';

export class ApiError extends Error {
  constructor(
    public readonly code: C.ErrorCode | 'NETWORK' | 'PROTOCOL',
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly retryAfter = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A user intent owns immutable bytes and a key. Only an explicit retry reuses it. */
export class CommandIntent {
  readonly key = crypto.randomUUID();
  readonly body: string | undefined;
  constructor(
    readonly path: string,
    readonly method: string,
    body?: unknown,
  ) {
    this.body = body === undefined ? undefined : C.canonicalJson(body);
  }
}
export class ActionScope {
  private commands = new Map<string, CommandIntent>();
  command(path: string, method: string, body?: unknown): CommandIntent {
    const signature = `${method} ${path} ${body === undefined ? '' : C.canonicalJson(body)}`;
    let intent = this.commands.get(signature);
    if (!intent) {
      intent = new CommandIntent(path, method, body);
      this.commands.set(signature, intent);
    }
    return intent;
  }
}

class ServerClock {
  private offset = 0;
  observe(serverTime: string) {
    this.offset = Date.parse(serverTime) - Date.now();
  }
  now = () => Date.now() + this.offset;
}
export const serverClock = new ServerClock();

const messages: Partial<Record<C.ErrorCode, string>> = {
  CSRF_REJECTED: '세션 정보를 새로 확인했어요. 내용을 확인하고 다시 눌러 주세요.',
  VERSION_CONFLICT: '조건이 바뀌었어요. 최신 내용을 확인하고 다시 선택해 주세요.',
  INVALID_STATE: '현재 상태에서는 이 동작을 할 수 없어요. 최신 내용을 확인해 주세요.',
  ALREADY_SELECTED: '이미 선택한 제안이 있어요. 결제 미리보기를 확인해 주세요.',
  AVAILABILITY_CONFLICT: '이 물품의 이용 가능 상태가 바뀌었어요. 다른 제안을 비교해 주세요.',
  QUOTE_EXPIRED: '가격 확인 시간이 지났어요. 가격을 새로 확인해 주세요.',
  IDEMPOTENCY_KEY_REUSED: '동작 정보를 다시 확인해야 해요. 화면을 새로 확인해 주세요.',
  REQUEST_EXPIRED: '요청 시간이 지났어요. 새 요청을 만들어 주세요.',
  OFFER_EXPIRED: '제안 시간이 지났어요. 남은 제안을 확인하거나 새 요청을 만들어 주세요.',
  UNKNOWN_DEMO_ID: '준비된 데모 아이디가 아니에요. 아래 예시에서 선택해 주세요.',
  NOT_FOUND: '내용을 찾을 수 없거나 이 아이디로 볼 수 없어요.',
  CHANGE_LIMIT_REACHED: '조건은 합쳐서 3회까지 변경할 수 있어요.',
  NO_CHANGES: '달라진 조건이 없어요. 기간·장소·금액을 확인해 주세요.',
  AI_UNAVAILABLE:
    'AI 연결을 사용할 수 없어요. 입력한 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.',
  TEMPORARILY_UNAVAILABLE: '서버에 잠시 연결할 수 없어요. 저장된 상태는 유지됩니다.',
};

export class ApiClient {
  csrfToken = '';
  private retryNotBefore = new Map<string, number>();
  private sessionEpoch = 0;
  private pendingPrivate = new Set<AbortController>();
  resetSession() {
    this.sessionEpoch++;
    this.csrfToken = '';
    this.retryNotBefore.clear();
    this.pendingPrivate.forEach((controller) => controller.abort());
    this.pendingPrivate.clear();
  }
  onUnauthorized: () => void = () => {};
  onRefresh: () => Promise<unknown> = async () => {};
  onStale: () => Promise<unknown> = async () => {};
  onSnapshot: (value: unknown) => void = () => {};
  async get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.request(path, schema, { method: 'GET', ...(signal ? { signal } : {}) });
  }
  async execute<T>(intent: CommandIntent, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = {};
    if (intent.body !== undefined) headers['Content-Type'] = 'application/json';
    if (intent.path !== '/demo-sessions') {
      headers['Idempotency-Key'] = intent.key;
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    return this.request(intent.path, schema, {
      method: intent.method,
      headers,
      ...(intent.body !== undefined ? { body: intent.body } : {}),
    });
  }
  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
    const epoch = this.sessionEpoch;
    const privateRequest =
      path !== '/demo-sessions' && path !== '/places' && !path.startsWith('/items');
    const outdated = () => privateRequest && epoch !== this.sessionEpoch;
    const waitUntil = this.retryNotBefore.get(path) ?? 0;
    if (serverClock.now() < waitUntil)
      throw new ApiError(
        'RATE_LIMITED',
        '요청이 많아요. 안내된 시간이 지난 뒤 다시 눌러 주세요.',
        {},
        waitUntil,
      );
    let response: Response;
    const controller = new AbortController();
    if (privateRequest) this.pendingPrivate.add(controller);
    const cancel = () => controller.abort();
    if (init.signal?.aborted) controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 30_000);
    try {
      response = await fetch(`/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (error) {
      if (outdated()) throw new DOMException('Previous session ended', 'AbortError');
      if (init.signal?.aborted) throw error;
      throw new ApiError(
        'NETWORK',
        '연결이 끊겨 결과를 확인하지 못했어요. 같은 동작 다시 시도로 결과를 확인해 주세요.',
      );
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', cancel);
      this.pendingPrivate.delete(controller);
    }
    if (outdated()) throw new DOMException('Previous session ended', 'AbortError');
    if (response.status === 204) return schema.parse(undefined);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiError('PROTOCOL', '서버 응답을 확인할 수 없어요. 상태 확인이 필요합니다.');
    }
    if (outdated()) throw new DOMException('Previous session ended', 'AbortError');
    if (!response.ok) {
      const parsed = C.ErrorEnvelopeSchema.safeParse(raw);
      if (!parsed.success)
        throw new ApiError(
          'PROTOCOL',
          '서버 오류 형식을 확인할 수 없어요. 상태 확인이 필요합니다.',
        );
      serverClock.observe(parsed.data.meta.serverTime);
      const { code, message, details } = parsed.data.error;
      if (response.status === 401) this.onUnauthorized();
      if (code === 'CSRF_REJECTED') await this.onRefresh().catch(() => {});
      if ([409, 410].includes(response.status)) await this.onStale().catch(() => {});
      const retryHeader = response.headers.get('Retry-After');
      const seconds = retryHeader ? Number(retryHeader) : 0;
      const retryAt = retryHeader
        ? Number.isFinite(seconds)
          ? serverClock.now() + seconds * 1000
          : Date.parse(retryHeader)
        : 0;
      if (code === 'RATE_LIMITED' && Number.isFinite(retryAt))
        this.retryNotBefore.set(path, retryAt);
      throw new ApiError(code, messages[code] ?? message, details, retryAt);
    }
    const result = C.successEnvelopeSchema(schema).safeParse(raw);
    if (!result.success)
      throw new ApiError(
        'PROTOCOL',
        '상태 확인 필요: 서버 데이터 형식이 달라졌어요. 새로 확인해 주세요.',
      );
    serverClock.observe(result.data.meta.serverTime);
    this.onSnapshot(result.data.data);
    return result.data.data;
  }
}
export const api = new ApiClient();
export const noContent = z.undefined();
export const idPath = (id: string) => encodeURIComponent(id);
export { formatKrw, formatSeoulDateTime } from '@sb/contracts';
