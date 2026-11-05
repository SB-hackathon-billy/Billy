import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PaymentPreviewSchema,
  RequestViewSchema,
  ReservationViewSchema,
  SelectOfferDataSchema,
  type RequestView,
} from '@sb/contracts';
import { api, formatKrw, idPath } from '../../lib/api.js';
import { useAction, useNow, useOnline, usePlaces, useRequest } from '../../lib/hooks.js';
import { durationLabel, secondsRemaining, sortComparison } from '../../lib/presentation.js';
import {
  ActionButton,
  Check,
  Countdown,
  ErrorNotice,
  Ink,
  ItemHeader,
  Loading,
  Status,
  TermsView,
} from '../../components/ui.js';
import { NeedEditor } from './NeedEditor.js';
import { Candidates } from './Candidates.js';
import { illustrations } from '../../assets/illustrations/manifest.js';
import { TaskExplanation } from '../../components/TaskExplanation.js';
import { availabilityReasonLabels, useReservations } from '../reservation/data.js';
import type { AvailabilityReason } from '@sb/contracts';
import { ReservationStatusBadge } from '../reservation/parts.js';

function Comparison({ view }: { view: RequestView }) {
  const [diff, setDiff] = useState(false);
  const places = usePlaces();
  const now = useNow();
  const action = useAction();
  const query = useQueryClient();
  const online = useOnline();
  const ready = view.comparison.filter((row) => row.selectable).length;
  return (
    <section>
      <p className="eyebrow">03 조건 모아보기</p>
      <h1>{ready ? '도착한 조건을\n비교해 보세요.' : '이웃의 답을\n기다리고 있어요.'}</h1>
      <div className="agent-note">
        <img
          className="state-illustration"
          src={ready ? illustrations.comparison.src : illustrations.waiting.src}
          alt=""
          aria-hidden="true"
        />
        <p>
          {ready
            ? `선택할 수 있는 조건 ${ready}개가 도착했어요. 날짜와 장소, 가격을 천천히 비교해 보세요.`
            : '요청을 전달했어요. 소유자가 직접 확인하고 답하면 이곳에 알려드려요.'}
        </p>
      </div>
      <Status value={view.request.status} />
      <p>조건이 바뀌면 여기에서 최신 내용을 확인할 수 있어요.</p>
      <TaskExplanation view={view} />
      <Check isSelected={diff} onChange={setDiff}>
        차이만 보기
      </Check>
      <ErrorNotice error={places.error} />
      {sortComparison(view).map((row) => {
        const branch = view.negotiations.find((n) => n.id === row.negotiationId);
        const selectable =
          row.selectable && !!branch?.offer && !!row.validUntil && Date.parse(row.validUntil) > now;
        return (
          <article className="content-card comparison-card" key={row.negotiationId}>
            <div className="card-topline">
              <Status value={row.status} />
              {branch && (
                <span className="muted">
                  조건 {branch.termsRevision} · 변경 {branch.changeCount}/3
                </span>
              )}
            </div>
            <ItemHeader item={row.itemSummary} />
            <TermsView
              terms={row.terms}
              places={places.data?.items ?? []}
              changed={row.changedFields}
              differencesOnly={diff}
            />
            <TaskExplanation view={view} negotiationId={row.negotiationId} />
            {row.validUntil && <Countdown until={row.validUntil} />}
            {row.unavailableReason && (
              <p>
                {availabilityReasonLabels[row.unavailableReason as AvailabilityReason] ??
                  row.unavailableReason}
              </p>
            )}
            {row.status === 'AWAITING_OWNER' && (
              <p className="field-hint">소유자가 직접 응답할 때까지 기다려 주세요.</p>
            )}
            {row.status === 'PENDING_PUBLIC' && (
              <p className="field-hint">센터 데모 어댑터가 확인 중이에요. 실제 접수가 아닙니다.</p>
            )}
            {selectable && view.allowedActions.includes('SELECT_OFFER') && (
              <Link
                className="button"
                to={`/requests/${view.request.id}/select/${row.negotiationId}`}
              >
                이 조건 선택하기
              </Link>
            )}
            {row.status === 'OFFERED' &&
              row.itemSummary.source === 'RESIDENT' &&
              branch &&
              branch.changeCount < 3 &&
              view.allowedActions.includes('REQUESTER_COUNTER') && (
                <Link
                  className="button secondary"
                  to={`/requests/${view.request.id}/counter/${row.negotiationId}`}
                >
                  조건 수정 제안
                </Link>
              )}
            {branch &&
              ['AWAITING_OWNER', 'OFFERED', 'PENDING_PUBLIC'].includes(row.status) &&
              view.allowedActions.includes('WITHDRAW_BRANCH') && (
                <ActionButton
                  secondary
                  isDisabled={action.pending || action.canRetry || !online}
                  onPress={() =>
                    action.run(async (scope) => {
                      const updated = await api.execute(
                        scope.command(`/negotiations/${idPath(branch.id)}/withdraw`, 'POST', {
                          expectedNegotiationVersion: branch.version,
                        }),
                        RequestViewSchema,
                      );
                      query.setQueryData(['request', view.request.id], updated);
                      void query.invalidateQueries({ queryKey: ['sync'] });
                    })
                  }
                >
                  이 후보 요청 철회
                </ActionButton>
              )}
          </article>
        );
      })}
      <ErrorNotice action={action} />
      {view.allowedActions.includes('CANCEL_REQUEST') && <CancelRequest view={view} />}
    </section>
  );
}
function CancelRequest({ view }: { view: RequestView }) {
  const action = useAction();
  const query = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const online = useOnline();
  return (
    <details className="cancel-request">
      <summary>전체 요청 취소</summary>
      <p>모든 활성 후보 요청이 종료됩니다.</p>
      <Check isSelected={confirm} onChange={setConfirm}>
        전체 요청을 취소하겠습니다.
      </Check>
      <ActionButton
        secondary
        isDisabled={!confirm || action.pending || action.canRetry || !online}
        onPress={() =>
          action.run(async (scope) => {
            const updated = await api.execute(
              scope.command(`/requests/${idPath(view.request.id)}/cancel`, 'POST', {
                expectedRequestVersion: view.request.version,
              }),
              RequestViewSchema,
            );
            query.setQueryData(['request', view.request.id], updated);
            void query.invalidateQueries({ queryKey: ['sync'] });
          })
        }
      >
        요청 취소하기
      </ActionButton>
      <ErrorNotice action={action} />
    </details>
  );
}
export function RequestPage({ edit = false }: { edit?: boolean }) {
  const { requestId = '' } = useParams();
  const request = useRequest(requestId);
  if (request.isPending) return <Loading />;
  if (!request.data) return <ErrorNotice error={request.error} />;
  const view = request.data;
  if (view.request.status === 'DRAFT' || (edit && view.allowedActions.includes('EDIT_DRAFT')))
    return <NeedEditor key={view.request.id} view={view} />;
  if (view.request.status === 'MATCHES_READY') return <Candidates view={view} />;
  if (view.request.status === 'PAYMENT_PREVIEW_READY')
    return <Navigate to={`/requests/${requestId}/payment`} replace />;
  if (view.request.status === 'SEARCHING')
    return (
      <section>
        <p className="eyebrow">물품 찾는 중</p>
        <h1>
          함께 쓸 물건을
          <br />
          찾고 있어요.
        </h1>
        <Ink active />
        <Loading>공공 물품과 이웃의 물품, 대여료를 확인하고 있어요.</Loading>
        <p>화면을 닫아도 요청은 서버에서 계속 진행됩니다.</p>
        <ErrorNotice error={request.error} />
        <CancelRequest view={view} />
      </section>
    );
  if (view.request.status === 'COLLECTING_OFFERS') return <Comparison view={view} />;
  return (
    <section>
      <p className="eyebrow">내 요청</p>
      <h1>{view.request.need.queryText || '공유대여 요청'}</h1>
      <Status value={view.request.status} />
      <div className="empty-card">
        <Ink small />
        <p>
          {view.request.status === 'NO_MATCH'
            ? '이 기간과 장소에 맞는 물품을 찾지 못했어요.'
            : view.request.status === 'FAILED'
              ? '물품을 찾는 중 문제가 생겼어요. 저장된 조건을 확인하고 새 요청을 시작할 수 있어요.'
              : '이 요청은 종료되었어요. 새로운 조건으로 다시 찾아볼 수 있어요.'}
        </p>
      </div>
      <Link className="button" to="/rental">
        새 요청 시작하기
      </Link>
      <Link className="button secondary" to="/inbox">
        요청함으로
      </Link>
    </section>
  );
}

export function SelectPage() {
  const { requestId = '', negotiationId = '' } = useParams();
  const request = useRequest(requestId);
  const places = usePlaces();
  const query = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const now = useNow();
  const online = useOnline();
  const [confirmed, setConfirmed] = useState(false);
  const [seenVersion, setSeenVersion] = useState<number | null>(null);
  const view = request.data;
  const branch = view?.negotiations.find((n) => n.id === negotiationId);
  const row = view?.comparison.find((r) => r.negotiationId === negotiationId);
  useEffect(() => {
    setConfirmed(false);
  }, [view?.request.version, branch?.version]);
  useEffect(() => {
    if (view && seenVersion === null) setSeenVersion(view.request.version);
  }, [view, seenVersion]);
  if (request.isPending) return <Loading />;
  if (view?.request.status === 'PAYMENT_PREVIEW_READY')
    return <Navigate to={`/requests/${requestId}/payment`} replace />;
  if (!view || !branch || !row)
    return <ErrorNotice error={request.error ?? new Error('제안을 찾을 수 없어요.')} />;
  const valid = row.selectable && branch.offer && Date.parse(branch.offer.validUntil) > now;
  return (
    <section>
      <p className="eyebrow">04 마지막 확인</p>
      <h1>
        이 조건으로
        <br />
        선택할까요?
      </h1>
      {seenVersion !== view.request.version && (
        <p className="demo-notice" role="alert">
          다른 조건이 업데이트되었어요. 최신 내용을 다시 확인해 주세요.
        </p>
      )}
      <div className="content-card">
        <ItemHeader item={row.itemSummary} />
        <Status value={branch.status} />
        <TermsView
          terms={branch.terms}
          places={places.data?.items ?? []}
          changed={row.changedFields}
        />
        <p>조건 버전 {branch.termsRevision}</p>
        {branch.offer && <Countdown until={branch.offer.validUntil} />}
      </div>
      <div className="demo-notice">
        <strong>다른 후보 요청은 종료됩니다.</strong>
        <p>
          선택 후 10분 동안 데모 점유가 생깁니다. 결제 미리보기에서 확정하면 앱 안의 데모 예약이
          되고, 실제 결제와 기관 예약은 이루어지지 않습니다.
        </p>
      </div>
      <Check isSelected={confirmed} onChange={setConfirmed}>
        물품·기간·장소·총액을 확인했고, 다른 활성 후보 요청을 종료하는 데 동의합니다.
      </Check>
      <ErrorNotice action={action} />
      {!valid && (
        <p role="alert">
          현재 이 제안을 선택할 수 없어요. 비교 화면에서 최신 조건을 확인해 주세요.
        </p>
      )}
      <ActionButton
        isDisabled={!valid || !confirmed || action.pending || action.canRetry || !online}
        onPress={() =>
          action.run(async (scope) => {
            const result = await api.execute(
              scope.command(`/requests/${idPath(requestId)}/select`, 'POST', {
                expectedRequestVersion: view.request.version,
                negotiationId,
                expectedNegotiationVersion: branch.version,
                offerId: branch.offer!.id,
                termsRevision: branch.termsRevision,
                acknowledgeCloseOtherBranches: true,
              }),
              SelectOfferDataSchema,
            );
            query.setQueryData(['request', requestId], result.request);
            query.setQueryData(['payment', requestId], result.paymentPreview);
            void query.invalidateQueries({ queryKey: ['sync'] });
            navigate(`/requests/${requestId}/payment`);
          })
        }
      >
        {action.pending ? '선택을 확인하는 중…' : '선택하고 결제 미리보기'}
      </ActionButton>
      <Link className="button secondary" to={`/requests/${requestId}`}>
        비교로 돌아가기
      </Link>
    </section>
  );
}
export function PaymentPage() {
  const { requestId = '' } = useParams();
  const places = usePlaces();
  const now = useNow();
  const preview = useQuery({
    queryKey: ['payment', requestId],
    queryFn: ({ signal }) =>
      api.get(`/requests/${idPath(requestId)}/payment-preview`, PaymentPreviewSchema, signal),
  });
  const [method, setMethod] = useState('demo-card');
  // 명세 0004: 선택한 제안을 앱 안의 데모 예약(CONFIRMED)으로 확정한다. 결제는 없다.
  const reservations = useReservations('REQUESTER', requestId);
  const confirmAction = useAction();
  const online = useOnline();
  const navigate = useNavigate();
  const query = useQueryClient();
  const data = preview.data;
  if (preview.isPending) return <Loading />;
  if (!data) return <ErrorNotice error={preview.error} />;
  const seconds = secondsRemaining(data.demoHoldExpiresAt, now);
  const active = data.demoHoldStatus === 'ACTIVE' && seconds > 0;
  const booked = reservations.data?.items[0];
  const confirm = () =>
    confirmAction.run(async (scope) => {
      const created = await api.execute(
        scope.command('/reservations', 'POST', {
          itemId: data.itemSummary.id,
          startAt: data.terms.startAt,
          endAt: data.terms.endAt,
          placeId: data.terms.placeId,
          requestId: data.requestId,
          negotiationId: data.negotiationId,
        }),
        ReservationViewSchema,
      );
      query.setQueryData(['reservation', created.reservation.id], created);
      void query.invalidateQueries({ queryKey: ['reservations'] });
      void query.invalidateQueries({ queryKey: ['payment', requestId] });
      navigate(`/reservations/${created.reservation.id}`);
    });
  return (
    <section>
      <p className="eyebrow">05 결제 미리보기</p>
      <h1>
        선택한 조건을
        <br />한 번 더 확인해요.
      </h1>
      <Status value="PAYMENT_PREVIEW_READY" />
      <p className="demo-notice">
        <strong>실제 결제와 예약이 이루어지지 않습니다.</strong>
        <br />
        결제 정보를 입력하거나 비용을 청구하지 않아요. 아래에서 예약을 확정하면 앱 안의 데모 예약만
        만들어져요.
      </p>
      <div className="content-card">
        <ItemHeader item={data.itemSummary} />
        <TermsView terms={data.terms} places={places.data?.items ?? []} />
        <div className="payment-total">
          <span>데모 총 대여료</span>
          <strong>{formatKrw(data.totalFeeKrw)}</strong>
        </div>
      </div>
      {booked ? (
        <div className="content-card">
          <h2>앱 안의 데모 예약</h2>
          <ReservationStatusBadge status={booked.reservation.status} />
          <p>
            {booked.reservation.status === 'CONFIRMED'
              ? '이 조건으로 예약을 확정했어요. 기간이 점유되어 다른 이웃이 신청할 수 없어요.'
              : '이 조건으로 만든 예약은 종료됐어요.'}
          </p>
          <Link className="button" to={`/reservations/${booked.reservation.id}`}>
            예약 보기
          </Link>
        </div>
      ) : (
        <>
          <div className={`hold-notice ${active ? '' : 'expired'}`}>
            <strong>{active ? '데모 선택 유효시간' : '데모 선택 유효시간 종료'}</strong>
            {active && <span>{durationLabel(seconds)}</span>}
            <p>
              {active
                ? '중복 선택을 막기 위한 임시 점유이며 실제 예약이 아닙니다.'
                : '요약은 계속 볼 수 있어요. 다른 거래를 시험하려면 새 요청을 시작해 주세요.'}
            </p>
          </div>
          {active && (
            <div className="content-card">
              <h2>예약 확정</h2>
              <p>
                유효시간 안에 확정하면 앱 안의 데모 예약이 만들어지고 이 기간이 점유돼요. 결제는
                청구되지 않아요.
              </p>
              <ActionButton
                onPress={confirm}
                isDisabled={confirmAction.pending || confirmAction.canRetry || !online}
              >
                {confirmAction.pending ? '확정하는 중…' : '예약 확정하기 (결제 없음)'}
              </ActionButton>
              <ErrorNotice action={confirmAction} />
            </div>
          )}
        </>
      )}
      <fieldset className="content-card">
        <legend>가상 결제수단</legend>
        <label className="radio">
          <input
            type="radio"
            name="method"
            checked={method === 'demo-card'}
            onChange={() => setMethod('demo-card')}
          />
          데모 카드 · 청구되지 않음
        </label>
        <label className="radio">
          <input
            type="radio"
            name="method"
            checked={method === 'demo-wallet'}
            onChange={() => setMethod('demo-wallet')}
          />
          데모 간편결제 · 청구되지 않음
        </label>
      </fieldset>
      <ErrorNotice error={preview.error} />
      <Link className="button" to="/inbox">
        데모 확인 완료
      </Link>
      <p className="field-hint">요청함으로 이동해요. 결제 상태는 변경되지 않습니다.</p>
      {!active && (
        <Link className="button secondary" to="/rental">
          새 요청 시작하기
        </Link>
      )}
    </section>
  );
}
