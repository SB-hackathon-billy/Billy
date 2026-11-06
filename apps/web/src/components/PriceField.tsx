import { useQuery } from '@tanstack/react-query';
import { PricingQuoteSchema, type PriceQuoteBody, type PricingQuote } from '@sb/contracts';
import { CommandIntent, api, formatKrw } from '../lib/api.js';
import { useNow } from '../lib/hooks.js';
import { ActionButton, ErrorNotice, Loading } from './ui.js';

export function usePriceQuote(body: PriceQuoteBody, enabled = true) {
  return useQuery({
    queryKey: ['quote', body],
    enabled,
    queryFn: () =>
      api.execute(new CommandIntent('/price-quotes', 'POST', body), PricingQuoteSchema),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function PriceField({
  quote,
  amount,
  onChange,
  refresh,
  pending,
  error,
  disabled = false,
}: {
  quote?: PricingQuote;
  amount: number;
  onChange: (value: number) => void;
  refresh: () => void;
  pending: boolean;
  error: Error | null;
  disabled?: boolean;
}) {
  const now = useNow();
  const expired = quote && Date.parse(quote.expiresAt) <= now;
  return (
    <div className="price-field">
      <ErrorNotice error={error} />
      {pending && <Loading>대여료를 확인하고 있어요.</Loading>}
      {quote && (
        <>
          <span className="price-source">
            {quote.recommendationSource === 'AI'
              ? '✦ AI 추천'
              : quote.recommendationSource === 'PUBLIC_FIXED'
                ? '센터 고정 요금'
                : '기준 요금'}{' '}
            · {formatKrw(quote.recommendedKrw)}
          </span>
          <p className="field-hint">
            {quote.recommendationSource === 'BASELINE'
              ? '기준 일요금과 대여 기간으로 계산했어요.'
              : quote.reasonCode === 'FLEXIBLE_HANDOFF'
                ? '여러 만남 장소를 선택해 조율하기 편한 조건이에요.'
                : quote.reasonCode === 'REGISTERED_EXTRA_EFFORT'
                  ? '물품에 등록된 운반 부담을 반영했어요.'
                  : '물품의 기준 일요금과 대여 기간을 반영했어요.'}
          </p>
          <label>
            제안할 총 대여료
            <select
              aria-label="제안할 총 대여료"
              value={amount}
              onChange={(event) => onChange(Number(event.target.value))}
              disabled={pending || !!expired || disabled}
            >
              {Array.from(
                { length: Math.floor((quote.maxKrw - quote.minKrw) / 500) + 1 },
                (_, i) => quote.minKrw + i * 500,
              ).map((value) => (
                <option key={value} value={value}>
                  {formatKrw(value)}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">
            허용 범위 {formatKrw(quote.minKrw)} ~ {formatKrw(quote.maxKrw)} · 500원 단위
          </p>
          {expired && <p role="alert">가격 확인 시간이 지났어요. 새 가격을 확인해 주세요.</p>}
        </>
      )}
      {(error || expired || (!quote && !pending)) && (
        <ActionButton secondary onPress={refresh} isDisabled={pending}>
          가격 다시 확인
        </ActionButton>
      )}
    </div>
  );
}
