// 3번 물품 탐색·예약·알림 화면. 명세: docs/specs/0004-reservations-waitlist-notifications.md
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_VALUES,
  ReadNotificationsDataSchema,
  ReservationViewSchema,
  WaitlistEntrySchema,
  validatePeriod,
  type CatalogItem,
  type Category,
  type ItemSource,
  type Notification,
} from '@sb/contracts';
import { api, formatKrw, formatSeoulDateTime, serverClock } from '../../lib/api.js';
import { useAction, useNow, useOnline, usePlaces } from '../../lib/hooks.js';
import { categories, durationLabel, secondsRemaining } from '../../lib/presentation.js';
import { ActionButton, Check, ErrorNotice, Ink, Loading } from '../../components/ui.js';
import { PeriodFields } from '../../components/PeriodFields.js';
import {
  actorLabels,
  availabilityReasonLabels,
  closedReasonLabel,
  defaultPeriod,
  historyLabels,
  useAvailability,
  useCatalog,
  useCatalogItem,
  useNotifications,
  useReservation,
  useWaitlist,
  type CatalogFilters,
} from './data.js';
import { CancelReservation, OwnerResponse, PeriodLine, ReservationStatusBadge } from './parts.js';

function SourceLabel({
  item,
}: {
  item: Pick<CatalogItem, 'source' | 'ownerDisplayName' | 'mine'>;
}) {
  return (
    <span className="source-label">
      {item.mine
        ? '내 물품'
        : item.source === 'PUBLIC'
          ? '공공 · 센터 데모'
          : `이웃 · ${item.ownerDisplayName ?? '주민'}`}
    </span>
  );
}

function CatalogCard({ item, period }: { item: CatalogItem; period: string }) {
  const a = item.availability;
  return (
    <li>
      <Link className="catalog-card" to={`/catalog/${item.id}${period}`}>
        <img src={item.image.url} alt={item.image.alt} width="88" height="88" />
        <div>
          <SourceLabel item={item} />
          <strong>{item.title}</strong>
          <span className="muted">
            {categories[item.category]} · 하루 {formatKrw(item.dailyRateKrw)}
          </span>
          {a && (
            <span className={`availability ${a.status === 'AVAILABLE' ? 'is-available' : ''}`}>
              {a.status === 'AVAILABLE'
                ? `빌릴 수 있어요 · 총 ${formatKrw(a.totalFeeKrw)}`
                : (availabilityReasonLabels[a.reason!] ?? '빌릴 수 없어요')}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const filters: CatalogFilters = {
    q: params.get('q') ?? '',
    category: (params.get('category') as Category | null) ?? '',
    source: (params.get('source') as ItemSource | null) ?? '',
    startAt: params.get('startAt'),
    endAt: params.get('endAt'),
  };
  const periodValid =
    !!filters.startAt &&
    !!filters.endAt &&
    validatePeriod(filters.startAt, filters.endAt, serverClock.now()).valid;
  const [cursors, setCursors] = useState<string[]>([]);
  // 형식이 맞지 않는 기간은 서버에 보내지 않고 목록만 보여 준다.
  const page = useCatalog(
    periodValid ? filters : { ...filters, startAt: null, endAt: null },
    cursors.at(-1),
  );
  const [items, setItems] = useState<CatalogItem[]>([]);
  useEffect(() => setCursors([]), [params]);
  useEffect(() => {
    if (!page.data) return;
    setItems((previous) => (cursors.length ? [...previous, ...page.data.items] : page.data.items));
  }, [page.data, cursors.length]);
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch))
      if (value) next.set(key, value);
      else next.delete(key);
    setParams(next, { replace: true });
  };
  const periodQuery =
    filters.startAt && filters.endAt
      ? `?${new URLSearchParams({ startAt: filters.startAt, endAt: filters.endAt }).toString()}`
      : '';
  return (
    <section>
      <h1>
        동네에서 빌릴 수 있는
        <br />
        물건을 찾아보세요.
      </h1>
      <form
        className="catalog-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: q.trim() || null });
        }}
      >
        <label>
          <span className="visually-hidden">물건 이름</span>
          <input
            type="search"
            value={q}
            maxLength={100}
            placeholder="예: 프로젝터, 캐리어"
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <ActionButton type="submit" secondary>
          찾기
        </ActionButton>
      </form>
      <div className="filter-row">
        <label>
          분류
          <select
            value={filters.category}
            onChange={(event) => update({ category: event.target.value || null })}
          >
            <option value="">전체</option>
            {CATEGORY_VALUES.map((value) => (
              <option key={value} value={value}>
                {categories[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          빌려주는 곳
          <select
            value={filters.source}
            onChange={(event) => update({ source: event.target.value || null })}
          >
            <option value="">전체</option>
            <option value="PUBLIC">공공(센터)</option>
            <option value="RESIDENT">이웃</option>
          </select>
        </label>
      </div>
      <details className="period-filter" open={!!filters.startAt}>
        <summary>기간으로 빌릴 수 있는지 보기</summary>
        <PeriodFields
          startAt={filters.startAt}
          endAt={filters.endAt}
          onChange={(startAt, endAt) => update({ startAt, endAt })}
        />
        {filters.startAt && filters.endAt && !periodValid && (
          <p role="alert" className="field-hint">
            30분 단위, 1시간 이상 7일 이하, 지금 이후의 기간을 골라 주세요.
          </p>
        )}
        {filters.startAt && (
          <ActionButton secondary onPress={() => update({ startAt: null, endAt: null })}>
            기간 지우기
          </ActionButton>
        )}
      </details>
      {page.isPending && !items.length ? (
        <Loading />
      ) : page.error ? (
        <ErrorNotice error={page.error} />
      ) : !items.length ? (
        <div className="empty-card">
          <Ink small />
          <p>조건에 맞는 물품이 없어요. 검색어나 분류를 바꿔 보세요.</p>
          <Link className="text-link" to="/rental">
            상담 통화로 필요한 물건 알려 주기 →
          </Link>
        </div>
      ) : (
        <ul className="catalog-list" aria-label="물품 목록">
          {items.map((item) => (
            <CatalogCard key={item.id} item={item} period={periodValid ? periodQuery : ''} />
          ))}
        </ul>
      )}
      {page.data?.nextCursor && (
        <ActionButton
          secondary
          isDisabled={page.isFetching}
          onPress={() => setCursors([...cursors, page.data!.nextCursor!])}
        >
          더 보기
        </ActionButton>
      )}
    </section>
  );
}

export function CatalogItemPage() {
  const { itemId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = useQueryClient();
  const places = usePlaces();
  const online = useOnline();
  const detail = useCatalogItem(itemId);
  const waitlist = useWaitlist();
  const initial = useMemo(() => {
    const startAt = params.get('startAt');
    const endAt = params.get('endAt');
    return startAt && endAt ? { startAt, endAt } : defaultPeriod(serverClock.now());
  }, [params]);
  const [period, setPeriod] = useState<{ startAt: string | null; endAt: string | null }>(initial);
  const [placeId, setPlaceId] = useState<string>('');
  const [agreed, setAgreed] = useState(false);
  const valid =
    !!period.startAt &&
    !!period.endAt &&
    validatePeriod(period.startAt, period.endAt, serverClock.now()).valid;
  const availability = useAvailability(
    itemId,
    valid ? period.startAt : null,
    valid ? period.endAt : null,
  );
  const action = useAction();
  useEffect(() => setAgreed(false), [period.startAt, period.endAt, placeId]);
  const item = detail.data;
  useEffect(() => {
    if (item && !item.allowedPlaceIds.includes(placeId)) setPlaceId(item.allowedPlaceIds[0]!);
  }, [item, placeId]);
  if (detail.isPending) return <Loading />;
  if (!item) return <ErrorNotice error={detail.error} />;
  const a = availability.data;
  const priority = waitlist.data?.items.find(
    (entry) => entry.itemId === item.id && entry.status === 'NOTIFIED',
  );
  const placeLabel = (id: string) => places.data?.items.find((p) => p.id === id)?.label ?? id;
  const reserve = () =>
    action.run(async (scope) => {
      const created = await api.execute(
        scope.command('/reservations', 'POST', {
          itemId: item.id,
          startAt: period.startAt,
          endAt: period.endAt,
          placeId,
        }),
        ReservationViewSchema,
      );
      query.setQueryData(['reservation', created.reservation.id], created);
      void query.invalidateQueries({ queryKey: ['reservations'] });
      void query.invalidateQueries({ queryKey: ['waitlist'] });
      void query.invalidateQueries({ queryKey: ['catalog'] });
      navigate(`/reservations/${created.reservation.id}`);
    });
  const wait = () =>
    action.run(async (scope) => {
      await api.execute(
        scope.command('/waitlist-entries', 'POST', {
          itemId: item.id,
          startAt: period.startAt,
          endAt: period.endAt,
        }),
        WaitlistEntrySchema,
      );
      await query.invalidateQueries({ queryKey: ['waitlist'] });
      await query.invalidateQueries({ queryKey: ['catalog'] });
    });
  const myWait = waitlist.data?.items.find(
    (entry) =>
      entry.itemId === item.id &&
      ['WAITING', 'NOTIFIED', 'APPLIED'].includes(entry.status) &&
      valid &&
      Date.parse(entry.startAt) < Date.parse(period.endAt!) &&
      Date.parse(period.startAt!) < Date.parse(entry.endAt),
  );
  return (
    <section>
      <div className="catalog-hero">
        <img src={item.image.url} alt={item.image.alt} />
      </div>
      <SourceLabel item={item} />
      <h1 className="catalog-title">{item.title}</h1>
      <p className="muted">
        {categories[item.category]} · 하루 {formatKrw(item.dailyRateKrw)} · 주고받는 곳{' '}
        {item.allowedPlaceIds.map(placeLabel).join(', ')}
      </p>
      {item.description && <p className="catalog-description">{item.description}</p>}
      {priority?.priorityUntil && (
        <p className="priority-note" role="status">
          기다리던 기간이 비었어요. {formatSeoulDateTime(priority.priorityUntil)}까지 먼저 신청할 수
          있어요.
        </p>
      )}
      <section className="page-section">
        <h2>예약된 기간</h2>
        {item.occupied.length ? (
          <ul className="occupied-list">
            {item.occupied.map((o) => (
              <li key={`${o.kind}${o.startAt}`}>
                <PeriodLine startAt={o.startAt} endAt={o.endAt} />
                <span className="muted">
                  {o.kind === 'RESERVED'
                    ? '예약됨'
                    : o.kind === 'HELD'
                      ? '확정 대기 중'
                      : '빌려주지 않는 기간'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">앞으로 예약된 기간이 없어요.</p>
        )}
        {item.waitingCount > 0 && (
          <p className="field-hint">이 물품을 기다리는 이웃 {item.waitingCount}명</p>
        )}
      </section>
      {item.mine ? (
        <div className="page-section">
          <p>내가 등록한 물품이에요. 들어온 신청은 요청함의 빌려주기 탭에서 확인해요.</p>
          {item.source === 'RESIDENT' && item.id.startsWith('lst_') && (
            <Link className="button secondary" to={`/listings/${item.id}`}>
              등록글 관리
            </Link>
          )}
          <Link className="button secondary" to="/inbox?role=OWNER">
            요청함 빌려주기 탭
          </Link>
        </div>
      ) : (
        <div className="content-card reserve-card">
          <h2>대여 신청</h2>
          <PeriodFields
            startAt={period.startAt}
            endAt={period.endAt}
            onChange={(startAt, endAt) => setPeriod({ startAt, endAt })}
          />
          <label>
            주고받을 곳
            <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
              {item.allowedPlaceIds.map((id) => (
                <option key={id} value={id}>
                  {placeLabel(id)}
                </option>
              ))}
            </select>
          </label>
          {!valid && (
            <p className="field-hint" role="alert">
              30분 단위, 1시간 이상 7일 이하, 지금 이후의 기간을 골라 주세요.
            </p>
          )}
          {valid && availability.isPending && <Loading>빌릴 수 있는지 확인하고 있어요.</Loading>}
          <ErrorNotice error={availability.error} />
          {a?.status === 'AVAILABLE' && (
            <>
              <div className="payment-total">
                <span>
                  총 대여료 ({a.billingDays}일)
                  {item.source === 'PUBLIC' ? ' · 센터 데모 요금' : ''}
                </span>
                <strong>{formatKrw(a.totalFeeKrw)}</strong>
              </div>
              <p className="field-hint">
                {item.source === 'PUBLIC'
                  ? '센터(시연)가 곧 자동으로 응답해요. 실제 센터 접수와 결제는 없어요.'
                  : `${item.ownerDisplayName ?? '소유자'}님이 승인하면 이 기간이 확정돼요. 실제 결제는 없어요.`}
              </p>
              <Check isSelected={agreed} onChange={setAgreed}>
                기간·장소·대여료를 확인했어요.
              </Check>
              <ActionButton
                onPress={reserve}
                isDisabled={!agreed || action.pending || action.canRetry || !online}
              >
                {action.pending ? '신청하는 중…' : '대여 신청하기'}
              </ActionButton>
            </>
          )}
          {a?.status === 'UNAVAILABLE' && (
            <div className="unavailable-note" role="status">
              <p>{availabilityReasonLabels[a.reason!] ?? '이 기간에는 빌릴 수 없어요.'}</p>
              {myWait ? (
                <p className="field-hint">
                  이미 이 기간을 기다리고 있어요
                  {myWait.position ? ` (대기 ${myWait.position}번째)` : ''}. 자리가 나면 먼저
                  알려드려요.
                </p>
              ) : (
                a.waitlistable && (
                  <>
                    <p className="field-hint">
                      대기를 신청하면 자리가 났을 때 순서대로 먼저 알려드려요. 지금 기다리는 이웃{' '}
                      {a.waitingCount}명. 자동으로 예약되지는 않아요.
                    </p>
                    <ActionButton
                      secondary
                      onPress={wait}
                      isDisabled={action.pending || action.canRetry || !online}
                    >
                      이 기간 대기 신청
                    </ActionButton>
                  </>
                )
              )}
            </div>
          )}
          <ErrorNotice action={action} />
        </div>
      )}
      <Link className="text-link" to="/catalog">
        ← 목록으로
      </Link>
    </section>
  );
}

export function ReservationPage() {
  const { reservationId = '' } = useParams();
  const reservation = useReservation(reservationId);
  const places = usePlaces();
  const now = useNow();
  if (reservation.isPending) return <Loading />;
  if (!reservation.data) return <ErrorNotice error={reservation.error} />;
  const view = reservation.data;
  const r = view.reservation;
  const owner = view.role === 'OWNER';
  const seconds = r.responseDueAt ? secondsRemaining(r.responseDueAt, now) : 0;
  const place = places.data?.items.find((p) => p.id === r.placeId);
  const heading =
    r.status === 'CONFIRMED'
      ? '예약이 확정됐어요.'
      : r.status === 'PENDING'
        ? owner
          ? '대여 신청에\n응답해 주세요.'
          : '소유자의 응답을\n기다리고 있어요.'
        : '종료된 신청이에요.';
  return (
    <section>
      <p className="eyebrow">{owner ? '빌려주기 · 예약 신청' : '빌리기 · 내 예약'}</p>
      <h1>{heading}</h1>
      <ReservationStatusBadge status={r.status} />
      <div className="content-card">
        <div className="item-header">
          <img src={r.item.image.url} alt={r.item.image.alt} width="92" height="80" />
          <div>
            <span className="source-label">
              {r.source === 'PUBLIC'
                ? '공공 · 센터 데모'
                : `이웃 · ${r.item.ownerDisplayName ?? '주민'}`}
            </span>
            <h2>{r.item.title}</h2>
          </div>
        </div>
        <dl className="terms">
          <div>
            <dt>신청한 이웃</dt>
            <dd>{view.requesterDisplayName}</dd>
          </div>
          <div>
            <dt>시작</dt>
            <dd>{formatSeoulDateTime(r.startAt)}</dd>
          </div>
          <div>
            <dt>종료</dt>
            <dd>{formatSeoulDateTime(r.endAt)}</dd>
          </div>
          <div>
            <dt>만남 장소</dt>
            <dd>{place?.label ?? '장소 확인 중'}</dd>
          </div>
          <div>
            <dt>총 대여료</dt>
            <dd>{formatKrw(r.totalFeeKrw)}</dd>
          </div>
        </dl>
        {r.status === 'PENDING' && r.responseDueAt && (
          <p className="countdown">
            {seconds
              ? `응답 기한 ${formatSeoulDateTime(r.responseDueAt)} · 남은 시간 ${durationLabel(seconds)}`
              : '응답 기한이 지났어요. 곧 만료 처리돼요.'}
          </p>
        )}
        {r.status === 'PENDING' && r.source === 'PUBLIC' && (
          <p className="field-hint">센터(시연)가 곧 자동으로 응답해요.</p>
        )}
        {r.closedReason && <p className="field-hint">{closedReasonLabel(r.closedReason)}</p>}
        {r.origin === 'REQUEST' && r.requestId && !owner && (
          <Link className="text-link" to={`/requests/${r.requestId}/payment`}>
            협상·결제 미리보기 내용 보기 →
          </Link>
        )}
      </div>
      <p className="demo-notice">실제 결제와 기관 예약은 없어요. 앱 안의 데모 예약이에요.</p>
      {owner ? <OwnerResponse view={view} /> : <CancelReservation view={view} />}
      {view.history.length > 0 && (
        <div className="page-section">
          <h2>진행 기록</h2>
          <ol className="history-list">
            {view.history.map((h, index) => (
              <li key={index}>
                <span>{formatSeoulDateTime(h.at)}</span>
                <span>
                  {actorLabels[h.actor]} ·{' '}
                  {historyLabels[h.reason ?? ''] ?? closedReasonLabel(h.reason) ?? h.status}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {(r.status === 'DECLINED' || r.status === 'EXPIRED') && !owner && (
        <Link className="button secondary" to={`/catalog/${r.itemId}`}>
          다른 기간 찾아보기
        </Link>
      )}
      <Link className="button secondary" to={owner ? '/inbox?role=OWNER' : '/inbox'}>
        요청함으로
      </Link>
    </section>
  );
}

export function NotificationsPage() {
  const notifications = useNotifications();
  const navigate = useNavigate();
  const query = useQueryClient();
  const action = useAction();
  const read = (ids: string[] | 'ALL', then?: string | null) =>
    action.run(async (scope) => {
      await api.execute(
        scope.command(
          '/notifications/read',
          'POST',
          ids === 'ALL' ? { all: true } : { notificationIds: ids },
        ),
        ReadNotificationsDataSchema,
      );
      await query.invalidateQueries({ queryKey: ['notifications'] });
      if (then) navigate(then);
    });
  const open = (n: Notification) => (n.readAt ? n.link && navigate(n.link) : read([n.id], n.link));
  const data = notifications.data;
  return (
    <section>
      <h1>새 소식</h1>
      {data && data.unreadCount > 0 && (
        <ActionButton secondary onPress={() => read('ALL')} isDisabled={action.pending}>
          모두 읽음으로 표시 ({data.unreadCount})
        </ActionButton>
      )}
      <ErrorNotice action={action} />
      {notifications.isPending ? (
        <Loading />
      ) : !data ? (
        <ErrorNotice error={notifications.error} />
      ) : !data.items.length ? (
        <div className="empty-card">
          <Ink small />
          <p>아직 알림이 없어요. 신청·응답·대기 소식이 오면 여기에 모여요.</p>
        </div>
      ) : (
        <ul className="notification-list">
          {data.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`notification ${n.readAt ? '' : 'is-unread'}`}
                onClick={() => open(n)}
              >
                <strong>
                  {!n.readAt && <span className="unread-dot" aria-label="읽지 않음" />}
                  {n.title}
                </strong>
                <span>{n.body}</span>
                <span className="muted">{formatSeoulDateTime(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
