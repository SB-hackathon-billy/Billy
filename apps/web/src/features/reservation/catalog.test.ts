import { afterEach, expect, it, vi } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { catalogOptions, type CatalogFilters } from './data.js';

afterEach(() => vi.restoreAllMocks());

it('replaces loaded pages on refetch and resets pagination immediately when filters change', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let revision = 1;
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const params = new URL(path, 'https://qa.invalid').searchParams;
    const id = params.get('q') || (params.get('cursor') ? 'second' : 'first');
    return {
      items: [{ id, title: `revision-${revision}` }],
      nextCursor: params.get('q') || params.get('cursor') ? null : 'page-two',
    } as never;
  });
  const filters: CatalogFilters = { q: '', category: '', source: '', startAt: null, endAt: null };
  const options = catalogOptions(filters);
  const observer = new InfiniteQueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    await observer.fetchNextPage();
    expect(
      observer.getCurrentResult().data?.pages.flatMap((p) => p.items.map((i) => i.id)),
    ).toEqual(['first', 'second']);
    revision++;
    await client.invalidateQueries({ queryKey: options.queryKey });
    const items = observer.getCurrentResult().data!.pages.flatMap((p) => p.items);
    expect(items.map((i) => i.id)).toEqual(['first', 'second']);
    expect(items.every((i) => i.title === 'revision-2')).toBe(true);
    observer.setOptions(catalogOptions({ ...filters, q: 'new-filter' }));
    await observer.refetch();
    expect(
      observer.getCurrentResult().data?.pages.flatMap((p) => p.items.map((i) => i.id)),
    ).toEqual(['new-filter']);
  } finally {
    unsubscribe();
    client.clear();
  }
});
