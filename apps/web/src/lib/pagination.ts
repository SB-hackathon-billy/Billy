import type { z } from 'zod';
import { api, ApiError } from './api.js';

type Page = { items: unknown[]; nextCursor: string | null };

/** Load a complete existing list without changing its DTO, query key, or rendering. */
export async function allPages<T extends Page>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  getId: (item: T['items'][number]) => string = (item) => (item as { id: string }).id,
): Promise<T> {
  const url = new URL(path, 'https://pagination.invalid');
  const seen = new Set<string>();
  let result: T | undefined;
  const items = new Map<string, T['items'][number]>();
  for (;;) {
    signal?.throwIfAborted();
    const page = await api.get(url.pathname + url.search, schema, signal);
    result ??= page;
    for (const item of page.items) items.set(getId(item), item);
    if (!page.nextCursor) return { ...result, items: [...items.values()], nextCursor: null };
    if (seen.has(page.nextCursor))
      throw new ApiError(
        'PROTOCOL',
        '상태 확인 필요: 서버 데이터 형식이 달라졌어요. 새로 확인해 주세요.',
      );
    seen.add(page.nextCursor);
    url.searchParams.set('cursor', page.nextCursor);
  }
}
