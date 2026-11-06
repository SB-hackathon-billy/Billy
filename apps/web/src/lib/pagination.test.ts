import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { allPages } from './pagination.js';

const schema = z.object({
  items: z.array(z.object({ id: z.string(), value: z.number() })),
  nextCursor: z.string().nullable(),
  unreadCount: z.number(),
});
function response(items: { id: string; value: number }[], nextCursor: string | null) {
  return Response.json({
    data: { items, nextCursor, unreadCount: 3 },
    meta: {
      contractVersion: '0.3.0',
      serverTime: new Date().toISOString(),
      traceId: 'trace_pagination',
    },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('loads over 50 items, preserves filters and list metadata, and replaces overlapping IDs', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      response(
        Array.from({ length: 50 }, (_, i) => ({ id: String(i), value: i })),
        'next/+=',
      ),
    )
    .mockResolvedValueOnce(
      response(
        [
          { id: '49', value: 99 },
          { id: '50', value: 50 },
        ],
        null,
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const result = await allPages('/notifications?limit=50&unread=true', schema);
  expect(result.items).toHaveLength(51);
  expect(result.items.find((i) => i.id === '49')?.value).toBe(99);
  expect(result).toMatchObject({ nextCursor: null, unreadCount: 3 });
  const next = new URL(String(fetch.mock.calls[1]?.[0]), 'https://test.invalid');
  expect(next.searchParams.get('cursor')).toBe('next/+=');
  expect(next.searchParams.get('unread')).toBe('true');
});

it('rejects repeated cursors instead of looping or silently returning a partial list', async () => {
  const fetch = vi.fn().mockImplementation(async () => response([{ id: 'one', value: 1 }], 'same'));
  vi.stubGlobal('fetch', fetch);
  await expect(allPages('/catalog?limit=50', schema)).rejects.toMatchObject({ code: 'PROTOCOL' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps distinct reservation views using their nested reservation IDs', async () => {
  const viewSchema = z.object({
    items: z.array(z.object({ reservation: z.object({ id: z.string() }) })),
    nextCursor: z.string().nullable(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          items: [{ reservation: { id: 'rsv_one' } }, { reservation: { id: 'rsv_two' } }],
          nextCursor: null,
        },
        meta: {
          contractVersion: '0.3.0',
          serverTime: new Date().toISOString(),
          traceId: 'trace_nested',
        },
      }),
    ),
  );
  const result = await allPages(
    '/reservations?role=OWNER',
    viewSchema,
    undefined,
    (view) => view.reservation.id,
  );
  expect(result.items.map((view) => view.reservation.id)).toEqual(['rsv_one', 'rsv_two']);
});

it('does not request another page after the query is aborted', async () => {
  const controller = new AbortController();
  const fetch = vi.fn().mockImplementation(async () => {
    controller.abort();
    return response([], 'next');
  });
  vi.stubGlobal('fetch', fetch);
  await expect(allPages('/listings?mine=true', schema, controller.signal)).rejects.toBeDefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
