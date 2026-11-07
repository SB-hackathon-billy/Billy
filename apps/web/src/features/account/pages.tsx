import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { HUB_MANAGER_ID } from '@sb/contracts';
import { useSession, useSync } from '../../lib/session.js';
import { useAction, useOnline } from '../../lib/hooks.js';
import { ActionButton, ArrowBadge, ErrorNotice, Loading, Status } from '../../components/ui.js';
import { formatSeoulDateTime } from '../../lib/api.js';
import { illustrations } from '../../assets/illustrations/manifest.js';
import { isEmptyRequest } from '../../lib/presentation.js';
import { useReservations } from '../reservation/data.js';
import { ReservationCard } from '../reservation/parts.js';
import { NearbyHubs } from '../reservation/NearbyHubs.js';

export function EntryPage() {
  const { session, loading, signIn } = useSession();
  const action = useAction();
  const online = useOnline();
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const composing = useRef(false);
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return (
    <section className="entry-page">
      <img className="entry-logo" src="/brand/billy-logo.svg" alt="빌리" />
      <p className="entry-lead">
        우리 동네 공공 물품과 이웃의 물품을
        <br />
        한곳에서 찾아보세요!
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (composing.current) return;
          action.run(async (scope) => {
            await signIn(handle.trim(), scope);
            navigate('/');
          });
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current))
            e.preventDefault();
        }}
      >
        <label>
          <span className="visually-hidden">데모 아이디</span>
          <input
            name="handle"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="아이디"
            maxLength={64}
            required
          />
        </label>
        <ActionButton
          type="submit"
          aria-label="데모 시작하기"
          isDisabled={action.pending || !online || !handle.trim()}
        >
          {action.pending ? '들어가는 중…' : '시작하기'}
        </ActionButton>
      </form>
      <ErrorNotice action={action} />
      <h2 className="entry-pick">준비된 아이디 고르기</h2>
      <div className="handle-options">
        {['hana', 'duri', 'seul', 'jun', 'bom'].map((name, i) => (
          <button
            type="button"
            key={name}
            className="handle-chip"
            aria-pressed={handle === `demo-${name}`}
            onClick={() => setHandle(`demo-${name}`)}
          >
            {['하나', '두리', '슬', '준', '봄'][i]} – {name}
          </button>
        ))}
      </div>
      <Link className="button" to="/center">
        센터 안내 먼저 보기
      </Link>
    </section>
  );
}
export function HomePage() {
  const { session } = useSession();
  const sync = useSync();
  const recent = [...(sync.data?.requestSummaries ?? [])]
    .filter((request) => !isEmptyRequest(request, sync.data?.tasks))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const offered = sync.data?.requestSummaries.reduce((sum, r) => sum + r.offeredCount, 0) ?? 0;
  // 명세 0004: 다가오는 확정 예약.
  const reservations = useReservations('REQUESTER');
  const upcoming = (reservations.data?.items ?? [])
    .filter(
      (v) => v.reservation.status === 'CONFIRMED' && Date.parse(v.reservation.endAt) > Date.now(),
    )
    .sort((a, b) => a.reservation.startAt.localeCompare(b.reservation.startAt))
    .slice(0, 2);
  return (
    <section className="home-page">
      <img className="home-house" src="/brand/billy-house.svg" alt="" />
      <p className="home-hello">{session?.user.displayName}님, 안녕하세요</p>
      <h1 className="home-greeting">오늘은 무엇이 필요하신가요?</h1>
      {session?.user.id === HUB_MANAGER_ID && (
        <Link className="button secondary" to="/hub">
          거점 관리 · 인계·반납 기록하기
        </Link>
      )}
      <Link className="home-card home-ask" to="/rental">
        <span>필요한 물건을 알려주세요</span>
        <strong>
          감탄이에게 물어보기 <ArrowBadge />
        </strong>
      </Link>
      <Link className="home-card home-browse" to="/catalog">
        <strong>
          물품 둘러보기 <ArrowBadge />
        </strong>
        <span>공공·이웃 물품을 골라 바로 신청해요</span>
      </Link>
      {offered > 0 && (
        <Link className="new-offers" to="/inbox">
          새로운 조건 {offered}개가 기다리고 있어요 <span>확인하기 →</span>
        </Link>
      )}
      {upcoming.length > 0 && (
        <>
          <div className="section-heading">
            <h2>다가오는 예약</h2>
            <Link to="/inbox">모두 보기</Link>
          </div>
          {upcoming.map((view) => (
            <ReservationCard key={view.reservation.id} view={view} />
          ))}
        </>
      )}
      <div className="section-heading">
        <h2>최근 내 요청</h2>
        {recent.length > 0 && <Link to="/inbox">모두 보기</Link>}
      </div>
      <ErrorNotice error={sync.error} />
      {recent.map((request) => (
        <Link className="request-link" to={`/requests/${request.id}`} key={request.id}>
          <div>
            <strong>{request.needSummary.queryText || '작성 중인 요청'}</strong>
            <span>
              {request.needSummary.startAt
                ? formatSeoulDateTime(request.needSummary.startAt)
                : '기간을 정해 주세요'}
            </span>
          </div>
          <Status value={request.status} />
        </Link>
      ))}
      {!recent.length && (
        <div className="empty-card">
          <img
            className="state-illustration"
            src={illustrations.empty.src}
            alt=""
            aria-hidden="true"
          />
          <p>
            아직 요청이 없어요.
            <br />
            잠깐 필요한 물건부터 찾아볼까요?
          </p>
        </div>
      )}
      <NearbyHubs />
      <Link to="/center" className="button home-center">
        성북구 1인가구지원센터 살펴보기 →
      </Link>
    </section>
  );
}
export function ProfilePage() {
  const { session, signOut } = useSession();
  const action = useAction();
  const online = useOnline();
  return (
    <section>
      <h1>
        안녕하세요,
        <br />
        {session?.user.displayName}님
      </h1>
      <div className="content-card profile-id">
        <span className="muted">데모 아이디</span>
        <p className="profile-handle">{session?.user.handle}</p>
      </div>
      <Link className="button" to="/inbox">
        내 요청 내역 보기
      </Link>
      <div className="profile-switch">
        <h2>다른 아이디로 참여하기</h2>
        <p className="field-hint">
          현재 음성과 연결을 종료하고 아이디 입력 화면으로 이동합니다. 서버에 저장된 요청은
          유지됩니다.
        </p>
        <ActionButton
          secondary
          onPress={() => action.run(signOut)}
          isDisabled={action.pending || !online}
        >
          아이디 전환
        </ActionButton>
        <ErrorNotice action={action} />
      </div>
    </section>
  );
}
