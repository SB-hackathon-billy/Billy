import { useId, type ReactNode } from 'react';
import { Button, Checkbox, type ButtonProps } from 'react-aria-components';
import type { ChangedField, ItemSummary, Place, Terms } from '@sb/contracts';
import { ApiError, formatKrw, formatSeoulDateTime } from '../lib/api.js';
import {
  statusLabel,
  changedLabels,
  durationLabel,
  secondsRemaining,
} from '../lib/presentation.js';
import { useNow, type ActionState } from '../lib/hooks.js';

export function ActionButton({
  children,
  secondary,
  ...props
}: ButtonProps & { secondary?: boolean }) {
  return (
    <Button {...props} className={secondary ? 'button secondary' : 'button'}>
      {children}
    </Button>
  );
}
/** 디자이너 화면의 파란 동그라미 화살표. */
export function ArrowBadge() {
  return (
    <svg className="arrow-badge" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" />
      <path d="M7 12h9m-4-4 4 4-4 4" />
    </svg>
  );
}
export function Check({
  children,
  ...props
}: {
  children: ReactNode;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <Checkbox {...props} className="check">
      <span className="check-box" aria-hidden="true">
        ✓
      </span>
      <span>{children}</span>
    </Checkbox>
  );
}
export function Ink({ active = false, small = false }: { active?: boolean; small?: boolean }) {
  const id = useId().replaceAll(':', '');
  return (
    <svg
      className={`ink ${active ? 'ink-active' : ''} ${small ? 'ink-small' : ''}`}
      viewBox="0 0 220 140"
      aria-hidden="true"
    >
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="8" />
          <feDisplacementMap in="SourceGraphic" scale="6" />
        </filter>
      </defs>
      <ellipse cx="110" cy="124" rx="76" ry="8" fill="#DDE9FB" />
      <g filter={`url(#${id})`}>
        <path
          d="M65 26C26 51 24 92 52 110C77 127 110 109 113 79C117 46 86 15 65 26Z"
          fill="#162542"
          opacity=".92"
        />
        <path
          d="M150 17C122 35 102 73 121 98C139 122 181 113 189 83C198 53 173 11 150 17Z"
          fill="#A7EF21"
          opacity=".85"
        />
      </g>
      <circle cx="68" cy="78" r="3" fill="#FFFFFF" />
      <circle cx="86" cy="77" r="3" fill="#FFFFFF" />
      <path
        d="M72 88Q79 94 86 87"
        stroke="#FFFFFF"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="145" cy="73" r="3" fill="#162542" />
      <circle cx="162" cy="72" r="3" fill="#162542" />
      <path
        d="M146 83Q154 89 162 82"
        stroke="#162542"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M24 35l5-7m166 72l8 2M116 12l2-7"
        stroke="#A5C8B2"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase()}`}>{statusLabel(value)}</span>;
}
export function ErrorNotice({ error, action }: { error?: Error | null; action?: ActionState }) {
  const value = error ?? action?.error;
  const now = useNow();
  if (!value) return null;
  const wait =
    value instanceof ApiError ? Math.max(0, Math.ceil((value.retryAfter - now) / 1000)) : 0;
  const candidateErrors = value instanceof ApiError ? value.details.candidateErrors : null;
  return (
    <div className="error-notice" role="alert">
      <strong>내용을 확인해 주세요</strong>
      <p>{value.message}</p>
      {Array.isArray(candidateErrors) && (
        <ul>
          {candidateErrors.map((entry: unknown, i) => {
            const detail =
              entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
            return (
              <li key={i}>
                {typeof detail.message === 'string'
                  ? detail.message
                  : '선택 후보의 조건과 가격을 다시 확인해 주세요.'}
              </li>
            );
          })}
        </ul>
      )}
      {wait > 0 && <p>{wait}초 후 다시 시도할 수 있어요.</p>}
      {action?.canRetry && (
        <ActionButton secondary onPress={action.retry} isDisabled={action.pending || wait > 0}>
          같은 동작 다시 시도
        </ActionButton>
      )}
    </div>
  );
}
export function Loading({ children = '최신 내용을 확인하고 있어요.' }: { children?: ReactNode }) {
  return (
    <p className="loading" role="status">
      {children}
    </p>
  );
}
export function ItemHeader({ item }: { item: ItemSummary }) {
  return (
    <div className="item-header">
      <img src={item.image.url} alt={item.image.alt} width="92" height="80" />
      <div>
        <span className="source-label">
          {item.source === 'PUBLIC' ? '공공 · 센터' : `주민 · ${item.ownerDisplayName ?? '이웃'}`}
        </span>
        <h2>{item.title}</h2>
      </div>
    </div>
  );
}
export function TermsView({
  terms,
  places,
  changed = [],
  differencesOnly = false,
}: {
  terms: Terms;
  places: Place[];
  changed?: ChangedField[];
  differencesOnly?: boolean;
}) {
  const rows: { key: ChangedField; label: string; value: string }[] = [
    { key: 'START_AT', label: '시작', value: formatSeoulDateTime(terms.startAt) },
    { key: 'END_AT', label: '종료', value: formatSeoulDateTime(terms.endAt) },
    {
      key: 'PLACE',
      label: '만남 장소',
      value: places.find((p) => p.id === terms.placeId)?.label ?? '장소 확인 중',
    },
    { key: 'TOTAL_FEE', label: '총 대여료', value: formatKrw(terms.totalFeeKrw) },
  ];
  return (
    <>
      <dl className="terms">
        {rows
          .filter((row) => !differencesOnly || changed.includes(row.key))
          .map((row) => (
            <div key={row.key} className={changed.includes(row.key) ? 'term-changed' : ''}>
              <dt>{row.label}</dt>
              <dd>
                {row.value}
                {changed.includes(row.key) && (
                  <span className="changed-label">↳ {changedLabels[row.key]}</span>
                )}
              </dd>
            </div>
          ))}
      </dl>
      {differencesOnly && !changed.length && <p>처음 보낸 조건과 같아요.</p>}
    </>
  );
}
export function Countdown({ until, label = '제안 유효시간' }: { until: string; label?: string }) {
  const seconds = secondsRemaining(until, useNow());
  return (
    <p className="countdown">{seconds ? `${label} ${durationLabel(seconds)}` : `${label} 종료`}</p>
  );
}
