import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useRoutes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { centerRoutes } from './features/center/routes.js';
import { EntryPage, HomePage, ProfilePage } from './features/account/pages.js';
import { useSession } from './lib/session.js';
import { useOnline } from './lib/hooks.js';
import { ActionButton, Loading } from './components/ui.js';
import { ResultNotice } from './components/ResultNotice.js';
import { NotificationBell } from './features/reservation/NotificationBell.js';

const VoicePage = lazy(() =>
  import('./features/rental/VoicePage.js').then((module) => ({ default: module.VoicePage })),
);
// 명세 0003: /rental은 캐릭터·체크리스트·승인 바텀시트 통화 화면. 구 화면은 /rental/classic(텍스트 입력).
const VoiceCallPage = lazy(() =>
  import('./features/voice-call/VoiceCallPage.js').then((module) => ({
    default: module.VoiceCallPage,
  })),
);
const InboxPage = lazy(() =>
  import('./features/rental/InboxPage.js').then((module) => ({ default: module.InboxPage })),
);
const RequestPage = lazy(() =>
  import('./features/rental/RequestPages.js').then((module) => ({ default: module.RequestPage })),
);
const PaymentPage = lazy(() =>
  import('./features/rental/RequestPages.js').then((module) => ({ default: module.PaymentPage })),
);
const SelectPage = lazy(() =>
  import('./features/rental/RequestPages.js').then((module) => ({ default: module.SelectPage })),
);
const CounterPage = lazy(() =>
  import('./features/rental/CounterPage.js').then((module) => ({ default: module.CounterPage })),
);
const ListingsPage = lazy(() =>
  import('./features/listing/pages.js').then((module) => ({ default: module.ListingsPage })),
);
const NewListingPage = lazy(() =>
  import('./features/listing/pages.js').then((module) => ({ default: module.NewListingPage })),
);
const ListingEditPage = lazy(() =>
  import('./features/listing/pages.js').then((module) => ({ default: module.ListingEditPage })),
);
// 명세 0004: 3번 물품 탐색·예약·대기·알림
const CatalogPage = lazy(() =>
  import('./features/reservation/pages.js').then((module) => ({ default: module.CatalogPage })),
);
const CatalogItemPage = lazy(() =>
  import('./features/reservation/pages.js').then((module) => ({
    default: module.CatalogItemPage,
  })),
);
const ReservationPage = lazy(() =>
  import('./features/reservation/pages.js').then((module) => ({
    default: module.ReservationPage,
  })),
);
const NotificationsPage = lazy(() =>
  import('./features/reservation/pages.js').then((module) => ({
    default: module.NotificationsPage,
  })),
);

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  return loading ? <Loading /> : session ? children : <Navigate to="/entry" replace />;
}
function PwaUpdate() {
  const {
    needRefresh: [refresh],
    updateServiceWorker,
  } = useRegisterSW();
  const location = useLocation();
  const stable =
    ['/', '/inbox', '/me', '/entry', '/catalog', '/notifications'].includes(location.pathname) ||
    location.pathname.startsWith('/center');
  return refresh && stable ? (
    <div className="update-notice" role="status">
      <p>새 버전이 준비되었어요.</p>
      <ActionButton
        secondary
        onPress={() => {
          void updateServiceWorker(true);
        }}
      >
        지금 업데이트
      </ActionButton>
    </div>
  ) : null;
}
function TabIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H4V10" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    rental: (
      <>
        <path d="m3 7 9-4 9 4-9 4Z" />
        <path d="M3 7v11l9 4 9-4V7M12 11v11" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 4h18v16H3z" />
        <path d="M3 14h5l2 3h4l2-3h5" />
      </>
    ),
    center: (
      <>
        <path d="M4 21V8l8-5 8 5v13M2 21h20M9 21v-6h6v6" />
        <path d="M8 9h1m6 0h1" />
      </>
    ),
    lend: (
      <>
        <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
    catalog: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5" />
      </>
    ),
    me: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
function AppShell() {
  const { session, connection } = useSession();
  const online = useOnline();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  const entry = location.pathname === '/entry';
  // Approved reservation-tool calls that failed keep retrying in the background, also after a reload.
  useEffect(() => {
    if (!session) return;
    void import('./features/voice-call/reservation-outbox.js').then(
      ({ hasQueuedReservations, reservationOutbox }) => {
        if (hasQueuedReservations()) reservationOutbox.resume();
      },
    );
  }, [session]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 이동
      </a>
      <header className="app-header">
        <Link className="brand" to="/">
          <img src="/icon.svg" alt="" />
          성북 공유대여
        </Link>
        <div className="header-actions">
          <span className="demo-badge">DEMO</span>
          {session && !entry && (
            <>
              <NotificationBell />
              <NavLink className="header-icon" to="/me" aria-label="내 정보">
                <TabIcon name="me" />
              </NavLink>
            </>
          )}
        </div>
      </header>
      {session?.demoScenario === 'expiry-fast' && (
        <div className="scenario-banner">빠른 만료 시연</div>
      )}
      {import.meta.env.DEV && import.meta.env.VITE_API_MOCK === '1' && (
        <div className="mock-banner">개발용 모의 API · 실제 서버·음성 검증 아님</div>
      )}
      {!online ? (
        <div className="connection-notice" role="status">
          <strong>오프라인 상태예요.</strong>
          <p>
            서버에 다시 연결하면 최신 내용을 불러옵니다. 요청과 응답은 전송되지 않아요.{' '}
            <Link to="/center">저장된 센터 안내 보기</Link>
          </p>
        </div>
      ) : session && connection === 'polling' ? (
        <div className="connection-notice" role="status">
          실시간 연결을 복구 중이에요. 5초마다 최신 내용을 확인합니다.
        </div>
      ) : null}
      <main id="main-content" className="app-main" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      {session && <ResultNotice key={session.user.id} />}
      <PwaUpdate />
      {!entry && (
        <nav className="bottom-tabs" aria-label="주 메뉴">
          {[
            ['/', '홈', 'home'],
            ['/catalog', '둘러보기', 'catalog'],
            ['/rental', '공유대여', 'rental'],
            ['/inbox', '요청함', 'inbox'],
            ['/listings', '빌려주기', 'lend'],
            ['/center', '센터', 'center'],
          ].map(([to, label, icon]) => (
            <NavLink key={to} to={to!} end={to === '/'}>
              <TabIcon name={icon!} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
export function App() {
  return useRoutes([
    {
      element: <AppShell />,
      children: [
        { path: '/entry', element: <EntryPage /> },
        {
          path: '/',
          element: (
            <Protected>
              <HomePage />
            </Protected>
          ),
        },
        {
          path: '/rental',
          element: (
            <Protected>
              <VoiceCallPage />
            </Protected>
          ),
        },
        {
          path: '/rental/classic',
          element: (
            <Protected>
              <VoicePage />
            </Protected>
          ),
        },
        {
          path: '/requests/:requestId',
          element: (
            <Protected>
              <RequestPage />
            </Protected>
          ),
        },
        {
          path: '/requests/:requestId/edit',
          element: (
            <Protected>
              <RequestPage edit />
            </Protected>
          ),
        },
        {
          path: '/requests/:requestId/select/:negotiationId',
          element: (
            <Protected>
              <SelectPage />
            </Protected>
          ),
        },
        {
          path: '/requests/:requestId/counter/:negotiationId',
          element: (
            <Protected>
              <CounterPage />
            </Protected>
          ),
        },
        {
          path: '/requests/:requestId/payment',
          element: (
            <Protected>
              <PaymentPage />
            </Protected>
          ),
        },
        {
          path: '/owner/:negotiationId/counter',
          element: (
            <Protected>
              <CounterPage owner />
            </Protected>
          ),
        },
        {
          path: '/inbox',
          element: (
            <Protected>
              <InboxPage />
            </Protected>
          ),
        },
        {
          path: '/me',
          element: (
            <Protected>
              <ProfilePage />
            </Protected>
          ),
        },
        ...(
          [
            ['/catalog', <CatalogPage />],
            ['/catalog/:itemId', <CatalogItemPage />],
            ['/reservations/:reservationId', <ReservationPage />],
            ['/notifications', <NotificationsPage />],
          ] as const
        ).map(([path, page]) => ({ path, element: <Protected>{page}</Protected> })),
        ...(
          [
            ['/listings', <ListingsPage />],
            ['/listings/new', <NewListingPage />],
            ['/listings/:listingId', <ListingEditPage />],
          ] as const
        ).map(([path, page]) => ({ path, element: <Protected>{page}</Protected> })),
        ...centerRoutes,
        {
          path: '*',
          element: (
            <section>
              <h1>페이지를 찾을 수 없어요</h1>
              <Link className="button" to="/">
                홈으로 이동
              </Link>
            </section>
          ),
        },
      ],
    },
  ]);
}
