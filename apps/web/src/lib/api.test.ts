import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ActionScope, ApiClient, ApiError, CommandIntent, serverClock } from './api.js';

const meta = () => ({
  contractVersion: '0.3.0',
  serverTime: new Date().toISOString(),
  traceId: 'trace_test',
});
const ok = () =>
  new Response(JSON.stringify({ data: { accepted: true }, meta: meta() }), { status: 200 });
const schema = z.object({ accepted: z.boolean() }).strict();
function failure(code: string, status: number, headers?: HeadersInit) {
  return new Response(
    JSON.stringify({
      error: { code, message: '오류', retryable: false, details: {} },
      meta: meta(),
    }),
    { status, ...(headers ? { headers } : {}) },
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  serverClock.observe(new Date().toISOString());
});

describe('immutable command intents', () => {
  it('replays identical bytes and key after an uncertain transport result', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    client.csrfToken = 'csrf';
    const body = { expectedRequestVersion: 3, selection: 'offer_one' };
    const intent = new CommandIntent('/requests/req_one/select', 'POST', body);
    body.expectedRequestVersion = 999;
    await expect(client.execute(intent, schema)).rejects.toMatchObject({ code: 'NETWORK' });
    await client.execute(intent, schema);
    const first = fetch.mock.calls[0]![1] as RequestInit;
    const retry = fetch.mock.calls[1]![1] as RequestInit;
    expect(first.body).toBe('{"expectedRequestVersion":3,"selection":"offer_one"}');
    expect(retry.body).toBe(first.body);
    expect(retry.headers).toEqual(first.headers);
    expect(first.headers).toMatchObject({ 'X-CSRF-Token': 'csrf', 'Idempotency-Key': intent.key });
  });
  it('reuses one logical step within a workflow but allocates new keys for new user actions', () => {
    const scope = new ActionScope();
    const initial = scope.command('/requests', 'POST', { b: 2, a: 1 });
    expect(scope.command('/requests', 'POST', { a: 1, b: 2 })).toBe(initial);
    expect(scope.command('/requests', 'POST', { a: 2, b: 2 }).key).not.toBe(initial.key);
    expect(new ActionScope().command('/requests', 'POST', { b: 2, a: 1 }).key).not.toBe(
      initial.key,
    );
  });
});
describe('API recovery boundaries', () => {
  it('discards a previous user response even if it completes after a session switch', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const client = new ApiClient();
    const pending = client.get('/requests/req_old', schema);
    client.resetSession();
    client.csrfToken = 'new-user-token';
    resolve(ok());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.csrfToken).toBe('new-user-token');
  });
  it('refreshes CSRF state without automatically replaying a mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(failure('CSRF_REJECTED', 403));
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    const refresh = vi.fn().mockResolvedValue(undefined);
    client.onRefresh = refresh;
    await expect(
      client.execute(new CommandIntent('/requests', 'POST', {}), schema),
    ).rejects.toMatchObject({ code: 'CSRF_REJECTED' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('invalidates snapshots on version conflict and never claims success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure('VERSION_CONFLICT', 409)));
    const client = new ApiClient();
    const stale = vi.fn().mockResolvedValue(undefined);
    client.onStale = stale;
    await expect(
      client.execute(new CommandIntent('/requests/req_one/select', 'POST', {}), schema),
    ).rejects.toBeInstanceOf(ApiError);
    expect(stale).toHaveBeenCalledOnce();
  });
  it('revokes user state on 401 and rejects unknown response shapes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure('SESSION_EXPIRED', 401))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accepted: 'yes' }, meta: meta() })),
      );
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    const revoke = vi.fn();
    client.onUnauthorized = revoke;
    await expect(client.get('/me', schema)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(revoke).toHaveBeenCalledOnce();
    await expect(client.get('/request', schema)).rejects.toMatchObject({ code: 'PROTOCOL' });
  });
  it('honors Retry-After before a second network call', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure('RATE_LIMITED', 429, { 'Retry-After': '10' }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    const intent = new CommandIntent('/price-quotes', 'POST', {});
    await expect(client.execute(intent, schema)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(client.execute(intent, schema)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_001);
    await expect(client.execute(intent, schema)).resolves.toEqual({ accepted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses same-origin credentials and never browser-caches API responses', async () => {
    const fetch = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetch);
    await new ApiClient().get('/sync', schema);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/sync',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
});
