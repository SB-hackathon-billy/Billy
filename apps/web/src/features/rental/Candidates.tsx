import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  RequestViewSchema,
  type Candidate,
  type CandidateSelection,
  type Place,
  type RequestView,
} from '@sb/contracts';
import { api, idPath, serverClock } from '../../lib/api.js';
import { useAction, useNow, useOnline, usePlaces } from '../../lib/hooks.js';
import { ActionButton, Check, ErrorNotice, ItemHeader, TermsView } from '../../components/ui.js';
import { PriceField, usePriceQuote } from '../../components/PriceField.js';
import { availabilityReasonLabels } from '../reservation/data.js';
import type { AvailabilityReason } from '@sb/contracts';

function CandidateCard({
  candidate,
  selected,
  blocked,
  onSelect,
  onQuote,
  places,
}: {
  candidate: Candidate;
  selected: boolean;
  blocked: boolean;
  onSelect: (selected: boolean) => void;
  onQuote: (selection: CandidateSelection, expiresAt: string) => void;
  places: Place[];
}) {
  const quote = usePriceQuote(
    {
      requestId: candidate.requestId,
      negotiationId: null,
      itemId: candidate.itemId,
      startAt: candidate.suggestedTerms.startAt,
      endAt: candidate.suggestedTerms.endAt,
    },
    candidate.availability === 'AVAILABLE',
  );
  const [amount, setAmount] = useState(candidate.suggestedTerms.totalFeeKrw);
  const now = useNow();
  useEffect(() => {
    if (quote.data) setAmount(quote.data.recommendedKrw);
  }, [quote.data?.id]);
  useEffect(() => {
    if (quote.data)
      onQuote(
        { candidateId: candidate.id, quoteId: quote.data.id, totalFeeKrw: amount },
        quote.data.expiresAt,
      );
  }, [quote.data, amount]);
  const available = candidate.availability === 'AVAILABLE';
  return (
    <article className={`content-card candidate ${selected ? 'is-selected' : ''}`}>
      <ItemHeader item={candidate.itemSummary} />
      <TermsView terms={{ ...candidate.suggestedTerms, totalFeeKrw: amount }} places={places} />
      {available ? (
        <>
          <PriceField
            disabled={blocked}
            {...(quote.data ? { quote: quote.data } : {})}
            amount={amount}
            onChange={setAmount}
            refresh={() => {
              void quote.refetch();
            }}
            pending={quote.isFetching}
            error={quote.error}
          />
          <p className="field-hint">
            {candidate.itemSummary.source === 'PUBLIC'
              ? '센터 신청'
              : '이웃이 직접 응답하면 조건을 비교할 수 있어요.'}
          </p>
          <Check
            isSelected={selected}
            onChange={onSelect}
            isDisabled={
              blocked || !quote.data || quote.isFetching || Date.parse(quote.data.expiresAt) <= now
            }
          >
            {candidate.itemSummary.title} 선택
          </Check>
        </>
      ) : (
        <p className="unavailable">
          선택 불가 ·{' '}
          {candidate.unavailableReason
            ? (availabilityReasonLabels[candidate.unavailableReason as AvailabilityReason] ??
              candidate.unavailableReason)
            : '이 조건으로 이용하기 어려워요.'}
        </p>
      )}
    </article>
  );
}
export function Candidates({ view }: { view: RequestView }) {
  const query = useQueryClient();
  const places = usePlaces();
  const action = useAction();
  const online = useOnline();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [prices, setPrices] = useState<
    Record<string, { selection: CandidateSelection; expiresAt: string }>
  >({});
  const [validation, setValidation] = useState('');
  const submit = () => {
    const selections = selected.map((id) => prices[id]);
    if (selections.some((entry) => !entry || Date.parse(entry.expiresAt) <= serverClock.now())) {
      setValidation('가격 확인 시간이 지났어요. 선택한 후보의 가격을 다시 확인해 주세요.');
      return;
    }
    action.run(async (scope) => {
      const next = await api.execute(
        scope.command(`/requests/${idPath(view.request.id)}/submit`, 'POST', {
          expectedRequestVersion: view.request.version,
          selections: selections.map((entry) => entry!.selection),
        }),
        RequestViewSchema,
      );
      query.setQueryData(['request', next.request.id], next);
      void query.invalidateQueries({ queryKey: ['sync'] });
    });
  };
  return (
    <section>
      <p className="eyebrow">02 함께 찾은 물품</p>
      <h1>
        필요한 만큼,
        <br />
        골라 요청해요.
      </h1>
      <p>
        공공 물품과 이웃의 물품을 함께 찾았어요.
        <br />
        최대 3개 후보에게 조건을 보낼 수 있어요.
      </p>
      <Link to={`/requests/${view.request.id}/edit`} className="text-link">
        찾는 조건 수정하기 →
      </Link>
      <ErrorNotice error={places.error} />
      {view.candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          places={places.data?.items ?? []}
          selected={selected.includes(candidate.id)}
          blocked={
            action.pending ||
            action.canRetry ||
            (!selected.includes(candidate.id) && selected.length >= 3)
          }
          onSelect={(checked) => {
            setSelected((ids) =>
              checked ? [...ids, candidate.id] : ids.filter((id) => id !== candidate.id),
            );
            setConfirmed(false);
          }}
          onQuote={(selection, expiresAt) =>
            setPrices((previous) => ({ ...previous, [candidate.id]: { selection, expiresAt } }))
          }
        />
      ))}
      <div className="content-card">
        <h2>요청 전 마지막 확인</h2>
        <p>{selected.length}개 후보 선택 · 물품마다 독립적으로 응답해요.</p>
        <Check isSelected={confirmed} onChange={setConfirmed}>
          선택한 주민에게 조건을 보내고, 공공 물품에는 센터 신청을 보냅니다.
        </Check>
        <p className="field-hint">여러 소유자가 응답해도 마지막에는 하나만 선택해요.</p>
        {validation && <p role="alert">{validation}</p>}
        <ErrorNotice action={action} />
        <ActionButton
          onPress={submit}
          isDisabled={
            !confirmed || !selected.length || action.pending || action.canRetry || !online
          }
        >
          {action.pending ? '요청을 보내는 중…' : `이 후보들에게 요청 · ${selected.length}개`}
        </ActionButton>
      </div>
    </section>
  );
}
