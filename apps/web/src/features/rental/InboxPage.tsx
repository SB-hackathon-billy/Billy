import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OwnerCardSchema, type OwnerCard } from '@sb/contracts';
import { api, formatSeoulDateTime, idPath } from '../../lib/api.js';
import { useAction, useOnline, usePlaces } from '../../lib/hooks.js';
import { useSync } from '../../lib/session.js';
import { reasonLabels } from '../../lib/presentation.js';
import {
  ActionButton,
  ErrorNotice,
  ItemHeader,
  Loading,
  Status,
  TermsView,
} from '../../components/ui.js';

function OwnerRequestCard({ card }: { card: OwnerCard }) {
  const places = usePlaces();
  const action = useAction();
  const query = useQueryClient();
  const online = useOnline();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('UNAVAILABLE');
  const branch = card.negotiation;
  const respond = (mode: 'APPROVE' | 'DECLINE') =>
    action.run(async (scope) => {
      await api.execute(
        scope.command(`/negotiations/${idPath(branch.id)}/owner-response`, 'POST', {
          expectedNegotiationVersion: branch.version,
          expectedTermsRevision: branch.termsRevision,
          action: mode,
          terms: null,
          ...(mode === 'DECLINE' ? { reasonCode: reason } : {}),
        }),
        OwnerCardSchema,
      );
      await query.invalidateQueries({ queryKey: ['sync'] });
      setDeclining(false);
    });
  return (
    <article className="content-card owner-card">
      <div className="card-topline">
        <Status value={branch.status} />
        <span className="muted">조건 {branch.termsRevision}</span>
      </div>
      <ItemHeader item={card.itemSummary} />
      <p>
        <strong>{card.requesterDisplayName}님</strong>이 빌리고 싶어해요.
      </p>
      <TermsView terms={branch.terms} places={places.data?.items ?? []} />
      <p className="field-hint">
        조건 변경 {branch.changeCount}/3회 · 표시된 조건을 확인하고 응답해 주세요.
      </p>
      {branch.responseDueAt && (
        <p className="field-hint">응답 기한 {formatSeoulDateTime(branch.responseDueAt)}</p>
      )}
      <ErrorNotice action={action} />
      {card.allowedActions.includes('OWNER_APPROVE') && (
        <ActionButton
          onPress={() => respond('APPROVE')}
          isDisabled={action.pending || action.canRetry || !online}
        >
          이 조건 승인
        </ActionButton>
      )}
      {card.allowedActions.includes('OWNER_COUNTER') && (
        <Link className="button secondary" to={`/owner/${branch.id}/counter`}>
          조건 변경 제안
        </Link>
      )}
      {card.allowedActions.includes('OWNER_DECLINE') && (
        <ActionButton
          secondary
          onPress={() => setDeclining(!declining)}
          isDisabled={action.pending || action.canRetry || !online}
        >
          거절 사유 선택
        </ActionButton>
      )}
      {declining && card.allowedActions.includes('OWNER_DECLINE') && (
        <div className="decline-form">
          <label>
            거절 사유
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              {Object.entries(reasonLabels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            secondary
            onPress={() => respond('DECLINE')}
            isDisabled={action.pending || action.canRetry || !online}
          >
            이 요청 거절
          </ActionButton>
        </div>
      )}
      {card.allowedActions.includes('WITHDRAW_BRANCH') && (
        <details className="cancel-request">
          <summary>이 제안 철회</summary>
          <p>이 후보의 조건이 종료됩니다.</p>
          <ActionButton
            secondary
            isDisabled={action.pending || action.canRetry || !online}
            onPress={() =>
              action.run(async (scope) => {
                await api.execute(
                  scope.command(`/negotiations/${idPath(branch.id)}/withdraw`, 'POST', {
                    expectedNegotiationVersion: branch.version,
                  }),
                  OwnerCardSchema,
                );
                await query.invalidateQueries({ queryKey: ['sync'] });
              })
            }
          >
            제안 철회하기
          </ActionButton>
        </details>
      )}
      {!card.allowedActions.length && (
        <p className="field-hint">이미 종료된 요청입니다. 추가 응답을 할 수 없어요.</p>
      )}
    </article>
  );
}
export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const owner = params.get('role') === 'OWNER';
  const sync = useSync();
  const requests = [...(sync.data?.requestSummaries ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const cards = [...(sync.data?.ownerCards ?? [])].sort((a, b) =>
    b.negotiation.updatedAt.localeCompare(a.negotiation.updatedAt),
  );
  return (
    <section>
      <p className="eyebrow">서로의 필요가 만나는 곳</p>
      <h1>요청함</h1>
      <div className="segmented" role="group" aria-label="요청함 종류">
        <ActionButton
          secondary
          aria-pressed={!owner}
          onPress={() => setParams({ role: 'REQUESTER' })}
        >
          빌리기
        </ActionButton>
        <ActionButton secondary aria-pressed={owner} onPress={() => setParams({ role: 'OWNER' })}>
          빌려주기
        </ActionButton>
      </div>
      <ErrorNotice error={sync.error} />
      {sync.isPending && <Loading />}
      {owner
        ? cards.map((card) => <OwnerRequestCard key={card.negotiation.id} card={card} />)
        : requests.map((request) => (
            <Link className="request-link" to={`/requests/${request.id}`} key={request.id}>
              <div>
                <strong>{request.needSummary.queryText || '작성 중인 요청'}</strong>
                <span>
                  {request.needSummary.startAt
                    ? formatSeoulDateTime(request.needSummary.startAt)
                    : '기간 미정'}
                </span>
                <span>
                  {request.status === 'DRAFT'
                    ? sync.data?.tasks.some(
                        (task) =>
                          task.requestId === request.id &&
                          ['QUEUED', 'RUNNING'].includes(task.status),
                      )
                      ? '신청서를 정리하고 있어요. 완료되면 알려드릴게요.'
                      : sync.data?.tasks.some(
                            (task) =>
                              task.requestId === request.id &&
                              task.kind === 'EXTRACT_NEED' &&
                              task.status === 'FAILED',
                          )
                        ? '신청서를 정리하지 못했어요. 직접 작성해 주세요.'
                        : '신청서 정보를 확인하고 이어서 작성해 주세요.'
                    : request.status === 'SEARCHING'
                      ? '등록 물품을 조회하고 있어요.'
                      : request.status === 'NO_MATCH'
                        ? '조건에 맞는 등록 물품이 없어요.'
                        : request.status === 'MATCHES_READY'
                          ? '물품 조회 결과가 도착했어요.'
                          : `조건 도착 ${request.offeredCount}개 · 진행 중 ${request.activeBranchCount}개`}
                </span>
              </div>
              <Status value={request.status} />
            </Link>
          ))}
      {!sync.isPending && !(owner ? cards.length : requests.length) && (
        <div className="empty-card">
          <h2>{owner ? '아직 도착한 요청이 없어요' : '아직 요청이 없어요'}</h2>
          <p>
            {owner
              ? '내 물품에 요청이 오면 이곳에서 확인하고 응답할 수 있어요.'
              : '필요한 물건이 생기면 함께 찾아볼게요.'}
          </p>
          {!owner && (
            <Link className="button" to="/rental">
              새 요청 시작하기
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
