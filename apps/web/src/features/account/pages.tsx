import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useSession, useSync } from '../../lib/session.js';
import { useAction, useOnline } from '../../lib/hooks.js';
import { ActionButton, ErrorNotice, Ink, Loading, Status } from '../../components/ui.js';
import { formatSeoulDateTime } from '../../lib/api.js';
import { illustrations } from '../../assets/illustrations/manifest.js';
import { useReservations } from '../reservation/data.js';
import { ReservationCard } from '../reservation/parts.js';

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
      <div className="entry-art">
        <Ink />
      </div>
      <h1>
        필요할 때 잠깐,
        <br />
        함께 쓰는 일상.
      </h1>
      <p className="lead">
        우리 동네 공공 물품과 이웃의 물품을
        <br />
        한곳에서 찾아보세요.
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
          데모 아이디
          <input
            name="handle"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="demo-hana"
            maxLength={64}
            required
          />
        </label>
        <ActionButton type="submit" isDisabled={action.pending || !online || !handle.trim()}>
          {action.pending ? '들어가는 중…' : '데모 시작하기'}
        </ActionButton>
      </form>
      <ErrorNotice action={action} />
      <p className="field-hint">준비된 아이디를 골라도 좋아요</p>
      <div className="handle-options">
        {['hana', 'duri', 'seul', 'jun'].map((name, i) => (
          <ActionButton secondary key={name} onPress={() => setHandle(`demo-${name}`)}>
            {['하나', '두리', '슬', '준'][i]} · demo-{name}
          </ActionButton>
        ))}
      </div>
      <aside className="demo-notice">
        <strong>데모 아이디는 신원 인증이 아니에요.</strong>
        <p>
          같은 아이디를 입력하면 같은 합성 계정을 사용합니다. 함께 시연할 때는 서로 다른 아이디와
          기기·브라우저 프로필을 사용해 주세요.
        </p>
        <p>실제 결제와 기관 예약은 이루어지지 않습니다. 예약은 앱 안의 데모 상태예요.</p>
      </aside>
      <Link to="/center">센터 안내 먼저 보기 →</Link>
    </section>
  );
}
export function HomePage() {
  const { session } = useSession();
  const sync = useSync();
  const recent = [...(sync.data?.requestSummaries ?? [])]
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
    <section>
      <p className="home-hello">{session?.user.displayName}님, 안녕하세요</p>
      <h1 className="home-greeting">
        오늘은 무엇이
        <br />
        필요하세요?
      </h1>
      <Link className="voice-hero" to="/rental">
        <img
          className="home-illustration"
          src={illustrations['sharing-home'].src}
          alt=""
          aria-hidden="true"
        />
        <span className="microphone" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <rect x="8" y="2" width="8" height="13" rx="4" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" />
          </svg>
        </span>
        <strong>
          필요한 물건,
          <br />
          알려만 주세요
        </strong>
        <span>
          말하거나 글로 요청하기 <b aria-hidden="true">→</b>
        </span>
      </Link>
      <Link className="catalog-teaser" to="/catalog">
        <strong>물품 둘러보기</strong>
        <span>공공·이웃 물품을 골라 바로 신청해요</span>
      </Link>
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
      {offered > 0 && (
        <Link className="new-offers" to="/inbox">
          새로운 조건 {offered}개가 기다리고 있어요 <span>확인하기 →</span>
        </Link>
      )}
      <div className="section-heading">
        <h2>최근 내 요청</h2>
        <Link to="/inbox">모두 보기</Link>
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
      <Link to="/center" className="center-teaser">
        <strong>성북구 1인가구지원센터</strong>
        <span>프로그램과 공간 살펴보기 →</span>
      </Link>
      <p className="demo-footnote">
        공공 신청·요금은 데모입니다. 주민의 응답은 참여자가 직접 결정해요.
      </p>
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
        <p className="field-hint">신원 인증이 아닌 시연용 계정입니다.</p>
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
      <p className="demo-notice">
        실제 결제와 기관 예약은 이루어지지 않습니다. 예약은 앱 안의 데모 상태예요.
      </p>
    </section>
  );
}
