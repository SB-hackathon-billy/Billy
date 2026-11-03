import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DemoSessionDataSchema,
  OwnerCardSchema,
  RequestViewSchema,
  SyncDataSchema,
  type DemoSessionData,
} from '@sb/contracts';
import { api, noContent, type ActionScope } from './api.js';
import { RealtimeSync, type ConnectionStatus } from './realtime.js';

interface SessionState {
  session: DemoSessionData | null;
  loading: boolean;
  connection: ConnectionStatus;
  signIn: (handle: string, action: ActionScope) => Promise<void>;
  signOut: (action: ActionScope) => Promise<void>;
}
const SessionContext = createContext<SessionState | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const query = useQueryClient();
  const [session, setSession] = useState<DemoSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const realtime = useRef<RealtimeSync | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);
  const identity = useRef<string | null>(null);
  const clear = useCallback(() => {
    generation.current++;
    window.dispatchEvent(new Event('sb:session-end'));
    realtime.current?.stop();
    realtime.current = null;
    void query.cancelQueries();
    query.clear();
    api.resetSession();
    identity.current = null;
    setSession(null);
    setLoading(false);
  }, [query]);
  const install = useCallback((value: DemoSessionData) => {
    api.csrfToken = value.csrfToken;
    identity.current = value.user.id;
    setSession(value);
  }, []);
  const refresh = useCallback(async () => {
    const version = generation.current;
    const value = await api.get('/me', DemoSessionDataSchema);
    if (version === generation.current) {
      if (identity.current && identity.current !== value.user.id) clear();
      install(value);
    }
    return value;
  }, [install, clear]);
  useEffect(() => {
    api.onUnauthorized = clear;
    api.onRefresh = refresh;
    api.onStale = () => query.invalidateQueries();
    setLoading(true);
    const bootGeneration = generation.current;
    void refresh()
      .catch(() => {})
      .finally(() => {
        if (bootGeneration === generation.current) setLoading(false);
      });
    channel.current = new BroadcastChannel('sb-demo-session');
    channel.current.onmessage = () => {
      clear();
      void refresh().catch(() => {});
    };
    return () => {
      channel.current?.close();
      clear();
    };
  }, [clear, query, refresh]);
  useEffect(() => {
    if (!session) return;
    setConnection('connecting');
    const sync = new RealtimeSync(query, setConnection, clear);
    realtime.current = sync;
    api.onSnapshot = (value) => {
      const request = RequestViewSchema.safeParse(value);
      if (request.success) {
        sync.gate.observeRequest(request.data.request.id, request.data.request.version);
        request.data.negotiations.forEach((n) => sync.gate.observeNegotiation(n.id, n.version));
      }
      const owner = OwnerCardSchema.safeParse(value);
      if (owner.success)
        sync.gate.observeNegotiation(owner.data.negotiation.id, owner.data.negotiation.version);
    };
    sync.start();
    return () => {
      sync.stop();
      api.onSnapshot = () => {};
    };
  }, [session?.user.id, query, clear]);
  const signIn = async (handle: string, action: ActionScope) => {
    const value = await api.execute(
      action.command('/demo-sessions', 'POST', { handle }),
      DemoSessionDataSchema,
    );
    clear();
    install(value);
    channel.current?.postMessage('changed');
  };
  const signOut = async (action: ActionScope) => {
    window.dispatchEvent(new Event('sb:session-end'));
    await api.execute(action.command('/demo-sessions/current', 'DELETE'), noContent);
    clear();
    channel.current?.postMessage('changed');
  };
  return (
    <SessionContext.Provider value={{ session, loading, connection, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is required');
  return context;
}
export function useSync() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['sync'],
    queryFn: ({ signal }) => api.get('/sync', SyncDataSchema, signal),
    enabled: !!session,
  });
}
