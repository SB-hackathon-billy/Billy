import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ItemSchema,
  PlaceSchema,
  RequestViewSchema,
  listDataSchema,
  type RequestView,
} from '@sb/contracts';
import { ActionScope, ApiError, api, idPath, serverClock } from './api.js';

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const busy = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback((work: (scope: ActionScope) => Promise<unknown>) => {
    if (busy.current) return;
    const scope = new ActionScope();
    const execute = async () => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        await work(scope);
        retry.current = null;
      } catch (caught) {
        const failure = caught instanceof Error ? caught : new Error('동작을 확인하지 못했어요.');
        if (mounted.current) setError(failure);
        // Only transport uncertainty is safely replayable without another condition review.
        retry.current = failure instanceof ApiError && failure.code === 'NETWORK' ? execute : null;
      } finally {
        busy.current = false;
        if (mounted.current) setPending(false);
      }
    };
    void execute();
  }, []);
  return {
    pending,
    error,
    run,
    retry: () => {
      void retry.current?.();
    },
    canRetry: !!retry.current,
    clearError: () => setError(null),
  };
}
export type ActionState = ReturnType<typeof useAction>;
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
export function useNow() {
  const [now, setNow] = useState(serverClock.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverClock.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    queryFn: ({ signal }) => api.get('/places', listDataSchema(PlaceSchema), signal),
    staleTime: 60_000,
  });
}
export function useItem(id: string) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: ({ signal }) => api.get(`/items/${idPath(id)}`, ItemSchema, signal),
    staleTime: 60_000,
  });
}
export function useRequest(id: string) {
  return useQuery({
    queryKey: ['request', id],
    queryFn: ({ signal }) => api.get(`/requests/${idPath(id)}`, RequestViewSchema, signal),
    structuralSharing: (old, next) => {
      const previous = old as RequestView | undefined;
      const incoming = next as RequestView;
      return previous && previous.request.version > incoming.request.version ? previous : incoming;
    },
    refetchInterval: (query) => (query.state.data?.request.status === 'SEARCHING' ? 2000 : false),
  });
}
