// 3번 예약·대기 카드와 명령 버튼. 명세: docs/specs/0004-reservations-waitlist-notifications.md
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  OWNER_REASON_CODE_VALUES,
  ReservationViewSchema,
  WaitlistEntrySchema,
  type OwnerReasonCode,
  type ReservationStatus,
  type ReservationView,
  type WaitlistEntry,
} from '@sb/contracts';
import { api, formatKrw, formatSeoulDateTime, idPath } from '../../lib/api.js';
import { useAction, useOnline, usePlaces } from '../../lib/hooks.js';
import { reasonLabels } from '../../lib/presentation.js';
import { ActionButton, Check, ErrorNotice } from '../../components/ui.js';
import { closedReasonLabel, reservationStatusLabels, waitlistStatusLabels } from './data.js';
import './reservation.css';

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`status status-r-${status.toLowerCase()}`}>
      {reservationStatusLabels[status]}
    </span>
  );
}

export function PeriodLine({ startAt, endAt }: { startAt: string; endAt: string }) {
  return (
    <span>
      {formatSeoulDateTime(startAt)} ~ {formatSeoulDateTime(endAt)}
    </span>
  );
}

/** 목록용 예약 카드. 상세 화면으로 이동한다. */
export function ReservationCard({ view }: { view: ReservationView }) {
  const r = view.reservation;
  const places = usePlaces();
  const place = places.data?.items.find((p) => p.id === r.placeId)?.label;
  return (
    <Link className="reservation-link" to={`/reservations/${r.id}`}>
      <img src={r.item.image.url} alt="" width="56" height="56" />
      <div>
        <strong>{r.item.title}</strong>
        <PeriodLine startAt={r.startAt} endAt={r.endAt} />
        <span>
          {view.role === 'OWNER' ? `${view.requesterDisplayName}님 · ` : ''}
          {place ?? '장소 확인 중'} · {formatKrw(r.totalFeeKrw)}
        </span>
        {r.status === 'PENDING' && r.responseDueAt && (
          <span>응답 기한 {formatSeoulDateTime(r.responseDueAt)}</span>
        )}
        {r.closedReason && <span>{closedReasonLabel(r.closedReason)}</span>}
      </div>
      <ReservationStatusBadge status={r.status} />
    </Link>
  );
}

function useRefreshReservations() {
  const query = useQueryClient();
  return (view?: ReservationView) => {
    if (view) query.setQueryData(['reservation', view.reservation.id], view);
    void query.invalidateQueries({ queryKey: ['reservations'] });
    void query.invalidateQueries({ queryKey: ['reservation'] });
    void query.invalidateQueries({ queryKey: ['catalog'] });
    void query.invalidateQueries({ queryKey: ['waitlist'] });
    void query.invalidateQueries({ queryKey: ['notifications'] });
  };
}

/** 소유자 승인·거절(사유 선택). 승인하면 그 기간이 점유된다. */
export function OwnerResponse({ view }: { view: ReservationView }) {
  const action = useAction();
  const online = useOnline();
  const refresh = useRefreshReservations();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<OwnerReasonCode>('UNAVAILABLE');
  const r = view.reservation;
  const respond = (mode: 'APPROVE' | 'DECLINE') =>
    action.run(async (scope) => {
      const updated = await api.execute(
        scope.command(`/reservations/${idPath(r.id)}/respond`, 'POST', {
          action: mode,
          expectedVersion: r.version,
          ...(mode === 'DECLINE' ? { reasonCode: reason } : {}),
        }),
        ReservationViewSchema,
      );
      setDeclining(false);
      refresh(updated);
    });
  if (!view.allowedActions.includes('OWNER_APPROVE')) return null;
  const disabled = action.pending || action.canRetry || !online;
  return (
    <div className="reservation-actions">
      <ErrorNotice action={action} />
      <ActionButton onPress={() => respond('APPROVE')} isDisabled={disabled}>
        {action.pending ? '처리하는 중…' : '승인하고 기간 확정'}
      </ActionButton>
      <ActionButton secondary onPress={() => setDeclining(!declining)} isDisabled={disabled}>
        거절 사유 선택
      </ActionButton>
      {declining && (
        <div className="decline-form">
          <label>
            거절 사유
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as OwnerReasonCode)}
            >
              {OWNER_REASON_CODE_VALUES.map((code) => (
                <option key={code} value={code}>
                  {reasonLabels[code]}
                </option>
              ))}
            </select>
          </label>
          <ActionButton secondary onPress={() => respond('DECLINE')} isDisabled={disabled}>
            이 신청 거절
          </ActionButton>
        </div>
      )}
    </div>
  );
}

/** 신청자 취소(응답 전, 또는 시작 전 확정 예약). */
export function CancelReservation({ view }: { view: ReservationView }) {
  const action = useAction();
  const online = useOnline();
  const refresh = useRefreshReservations();
  const [confirm, setConfirm] = useState(false);
  const r = view.reservation;
  if (!view.allowedActions.includes('CANCEL')) return null;
  return (
    <details className="cancel-request">
      <summary>{r.status === 'CONFIRMED' ? '예약 취소' : '신청 취소'}</summary>
      <p>
        {r.status === 'CONFIRMED'
          ? '확정된 기간이 풀리고, 기다리던 이웃에게 순서대로 알려요.'
          : '소유자에게 보낸 신청이 종료돼요.'}
      </p>
      <Check isSelected={confirm} onChange={setConfirm}>
        이 {r.status === 'CONFIRMED' ? '예약' : '신청'}을 취소하겠습니다.
      </Check>
      <ActionButton
        secondary
        isDisabled={!confirm || action.pending || action.canRetry || !online}
        onPress={() =>
          action.run(async (scope) => {
            const updated = await api.execute(
              scope.command(`/reservations/${idPath(r.id)}/cancel`, 'POST', {
                expectedVersion: r.version,
              }),
              ReservationViewSchema,
            );
            setConfirm(false);
            refresh(updated);
          })
        }
      >
        취소하기
      </ActionButton>
      <ErrorNotice action={action} />
    </details>
  );
}

export function WaitlistCard({ entry }: { entry: WaitlistEntry }) {
  const action = useAction();
  const online = useOnline();
  const refresh = useRefreshReservations();
  const open = ['WAITING', 'NOTIFIED', 'APPLIED'].includes(entry.status);
  const query = new URLSearchParams({ startAt: entry.startAt, endAt: entry.endAt });
  return (
    <article className={`waitlist-card ${entry.status === 'NOTIFIED' ? 'is-priority' : ''}`}>
      <div className="card-topline">
        <span className={`status status-w-${entry.status.toLowerCase()}`}>
          {waitlistStatusLabels[entry.status]}
        </span>
        {entry.position && <span className="muted">대기 {entry.position}번째</span>}
      </div>
      <strong>{entry.item.title}</strong>
      <p className="field-hint">
        <PeriodLine startAt={entry.startAt} endAt={entry.endAt} />
      </p>
      {entry.status === 'NOTIFIED' && entry.priorityUntil && (
        <p className="priority-note">
          {formatSeoulDateTime(entry.priorityUntil)}까지 나만 먼저 신청할 수 있어요.
        </p>
      )}
      {entry.closedReason && !open && (
        <p className="field-hint">{closedReasonLabel(entry.closedReason)}</p>
      )}
      {entry.status === 'NOTIFIED' && (
        <Link className="button" to={`/catalog/${entry.itemId}?${query.toString()}`}>
          지금 신청하러 가기
        </Link>
      )}
      {entry.status === 'FULFILLED' && entry.reservationId && (
        <Link className="text-link" to={`/reservations/${entry.reservationId}`}>
          예약 보기 →
        </Link>
      )}
      {open && (
        <ActionButton
          secondary
          isDisabled={action.pending || action.canRetry || !online}
          onPress={() =>
            action.run(async (scope) => {
              await api.execute(
                scope.command(`/waitlist-entries/${idPath(entry.id)}`, 'DELETE'),
                WaitlistEntrySchema,
              );
              refresh();
            })
          }
        >
          대기 취소
        </ActionButton>
      )}
      <ErrorNotice action={action} />
    </article>
  );
}
