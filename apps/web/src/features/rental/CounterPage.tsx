import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OwnerCardSchema,
  PricingQuoteSchema,
  RequestViewSchema,
  TermsSchema,
  validatePeriod,
  type ItemSummary,
  type Negotiation,
  type PricingQuote,
  type Terms,
} from '@sb/contracts';
import { api, idPath, serverClock } from '../../lib/api.js';
import { useAction, useItem, useNow, useOnline, usePlaces, useRequest } from '../../lib/hooks.js';
import { ActionButton, ErrorNotice, ItemHeader, Loading, TermsView } from '../../components/ui.js';
import { PeriodFields } from '../../components/PeriodFields.js';
import { PriceField } from '../../components/PriceField.js';
import { reasonLabels } from '../../lib/presentation.js';

function CounterForm({
  branch,
  item,
  owner,
}: {
  branch: Negotiation;
  item: ItemSummary;
  owner: boolean;
}) {
  const navigate = useNavigate();
  const query = useQueryClient();
  const places = usePlaces();
  const details = useItem(item.id);
  const action = useAction();
  const priceAction = useAction();
  const online = useOnline();
  const now = useNow();
  const [terms, setTerms] = useState(branch.terms);
  const [quote, setQuote] = useState<PricingQuote | undefined>();
  const [reason, setReason] = useState('OTHER_CONDITION');
  const [validation, setValidation] = useState('');
  const locked = action.pending || action.canRetry || priceAction.pending || priceAction.canRetry;
  const change = (next: Partial<Terms>) => {
    setTerms((t) => ({ ...t, ...next }));
    setQuote(undefined);
    setValidation('');
  };
  const validate = () => {
    const period = validatePeriod(terms.startAt, terms.endAt, serverClock.now());
    if (!period.valid) {
      setValidation(period.issues.join(' '));
      return false;
    }
    return true;
  };
  const refreshPrice = () => {
    if (!validate()) return;
    priceAction.run(async (scope) => {
      const result = await api.execute(
        scope.command('/price-quotes', 'POST', {
          requestId: branch.requestId,
          negotiationId: branch.id,
          itemId: branch.itemId,
          startAt: terms.startAt,
          endAt: terms.endAt,
        }),
        PricingQuoteSchema,
      );
      setQuote(result);
      setTerms((t) => ({ ...t, quoteId: result.id, totalFeeKrw: result.recommendedKrw }));
    });
  };
  const submit = () => {
    if (!validate() || !quote) return;
    const checked = TermsSchema.safeParse(terms);
    if (!checked.success) {
      setValidation('기간과 금액을 확인해 주세요.');
      return;
    }
    action.run(async (scope) => {
      const body = {
        expectedNegotiationVersion: branch.version,
        expectedTermsRevision: branch.termsRevision,
        terms: checked.data,
        reasonCode: reason,
      };
      if (owner) {
        const result = await api.execute(
          scope.command(`/negotiations/${idPath(branch.id)}/owner-response`, 'POST', {
            ...body,
            action: 'COUNTER',
          }),
          OwnerCardSchema,
        );
        query.setQueryData(['negotiation', branch.id], result);
      } else {
        const result = await api.execute(
          scope.command(`/negotiations/${idPath(branch.id)}/requester-counter`, 'POST', body),
          RequestViewSchema,
        );
        query.setQueryData(['request', branch.requestId], result);
      }
      void query.invalidateQueries({ queryKey: ['sync'] });
      navigate(owner ? '/inbox?role=OWNER' : `/requests/${branch.requestId}`);
    });
  };
  return (
    <section>
      <p className="eyebrow">조건 변경 · {branch.changeCount}/3회 사용</p>
      <h1>
        서로에게 맞게
        <br />
        조건을 조율해요.
      </h1>
      <ItemHeader item={item} />
      <details className="content-card">
        <summary>현재 조건 보기 · 버전 {branch.termsRevision}</summary>
        <TermsView terms={branch.terms} places={places.data?.items ?? []} />
      </details>
      <p>
        {owner
          ? '변경한 조건은 빌려줄 의사가 담긴 새 제안으로 전달됩니다.'
          : '수정 제안을 보내면 이전 제안은 선택할 수 없고, 소유자가 다시 확인합니다.'}
      </p>
      <div className="stack-form">
        <PeriodFields
          disabled={locked}
          startAt={terms.startAt}
          endAt={terms.endAt}
          onChange={(start, end) => {
            if (start && end) change({ startAt: start, endAt: end });
          }}
        />
        <label>
          만남 장소
          <select
            aria-label="만남 장소"
            disabled={locked}
            value={terms.placeId}
            onChange={(event) => change({ placeId: event.target.value })}
          >
            {places.data?.items
              .filter((place) => details.data?.allowedPlaceIds.includes(place.id))
              .map((place) => (
                <option value={place.id} key={place.id}>
                  {place.label}
                </option>
              ))}
          </select>
        </label>
        <ActionButton secondary onPress={refreshPrice} isDisabled={locked || !online}>
          변경 조건의 가격 확인
        </ActionButton>
        <PriceField
          {...(quote ? { quote } : {})}
          disabled={locked}
          amount={terms.totalFeeKrw}
          onChange={(totalFeeKrw) => setTerms((t) => ({ ...t, totalFeeKrw }))}
          refresh={priceAction.canRetry ? priceAction.retry : refreshPrice}
          pending={priceAction.pending}
          error={priceAction.error}
        />
        <label>
          변경 사유
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {Object.entries(reasonLabels)
              .filter(([code]) => code !== 'UNAVAILABLE')
              .map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {quote && (
          <div className="date-summary">
            <h2>보낼 새 조건</h2>
            <TermsView terms={terms} places={places.data?.items ?? []} />
          </div>
        )}
        {validation && (
          <p className="error-notice" role="alert">
            {validation}
          </p>
        )}
        <ErrorNotice error={details.error ?? places.error} />
        <ErrorNotice action={action} />
        <ActionButton
          onPress={submit}
          isDisabled={
            !quote ||
            Date.parse(quote.expiresAt) <= now ||
            action.pending ||
            action.canRetry ||
            priceAction.pending ||
            !online ||
            branch.changeCount >= 3
          }
        >
          {action.pending ? '변경 조건을 보내는 중…' : '이 조건으로 변경 제안'}
        </ActionButton>
        <Link
          className="button secondary"
          to={owner ? '/inbox?role=OWNER' : `/requests/${branch.requestId}`}
        >
          돌아가기
        </Link>
      </div>
    </section>
  );
}
function RequesterCounter() {
  const { requestId = '', negotiationId = '' } = useParams();
  const request = useRequest(requestId);
  const branch = request.data?.negotiations.find((n) => n.id === negotiationId);
  const row = request.data?.comparison.find((row) => row.negotiationId === negotiationId);
  if (request.isPending) return <Loading />;
  if (!branch || !row)
    return <ErrorNotice error={request.error ?? new Error('변경할 조건을 찾을 수 없어요.')} />;
  if (
    !request.data?.allowedActions.includes('REQUESTER_COUNTER') ||
    branch.status !== 'OFFERED' ||
    branch.source !== 'RESIDENT' ||
    branch.changeCount >= 3
  )
    return (
      <section>
        <h1>현재 조건을 변경할 수 없어요</h1>
        <Link to={`/requests/${requestId}`}>비교 화면으로</Link>
      </section>
    );
  return <CounterForm key={branch.version} branch={branch} item={row.itemSummary} owner={false} />;
}
function OwnerCounter() {
  const { negotiationId = '' } = useParams();
  const card = useQuery({
    queryKey: ['negotiation', negotiationId],
    queryFn: ({ signal }) =>
      api.get(`/negotiations/${idPath(negotiationId)}`, OwnerCardSchema, signal),
  });
  if (card.isPending) return <Loading />;
  if (!card.data) return <ErrorNotice error={card.error} />;
  if (!card.data.allowedActions.includes('OWNER_COUNTER'))
    return (
      <section>
        <h1>현재 조건을 변경할 수 없어요</h1>
        <Link to="/inbox?role=OWNER">요청함으로</Link>
      </section>
    );
  return (
    <CounterForm
      key={card.data.negotiation.version}
      branch={card.data.negotiation}
      item={card.data.itemSummary}
      owner
    />
  );
}
export function CounterPage({ owner = false }: { owner?: boolean }) {
  return owner ? <OwnerCounter /> : <RequesterCounter />;
}
