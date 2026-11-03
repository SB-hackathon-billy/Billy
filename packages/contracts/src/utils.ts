import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { KrwSchema, PeriodSchema, UtcDateTimeSchema } from './primitives.js';
import type { FeeOptions } from './ai.js';
import type { ItemSource } from './enums.js';

export type PeriodValidation = { valid: true; issues: [] } | { valid: false; issues: string[] };
/** Non-throwing validation using the caller's authoritative clock. */
export function validatePeriod(
  startAt: string,
  endAt: string,
  now: Date | string | number = new Date(),
): PeriodValidation {
  const result = PeriodSchema.safeParse({ startAt, endAt });
  const issues = result.success ? [] : result.error.issues.map((issue) => issue.message);
  const clock =
    now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(clock)) issues.push('서버 현재 시각이 올바르지 않습니다.');
  else if (UtcDateTimeSchema.safeParse(startAt).success && Date.parse(startAt) <= clock)
    issues.push('시작은 현재 시각 이후여야 합니다.');
  return issues.length ? { valid: false, issues } : { valid: true, issues: [] };
}
export interface ComputedFeeOptions {
  billingDays: number;
  baselineKrw: number;
  minKrw: number;
  maxKrw: number;
  feeOptions: FeeOptions;
}
/** PUBLIC fixes L=B=U. Clock validation is separate so stored/historical terms can be priced. */
export function computeFeeOptions(
  dailyRateKrw: number,
  startAt: string,
  endAt: string,
  source: ItemSource = 'RESIDENT',
): ComputedFeeOptions {
  KrwSchema.parse(dailyRateKrw);
  PeriodSchema.parse({ startAt, endAt });
  const billingDays = Math.ceil((Date.parse(endAt) - Date.parse(startAt)) / 86_400_000);
  // Integer arithmetic avoids floating-point drift at 500-KRW boundaries.
  const baseline = BigInt(dailyRateKrw) * BigInt(billingDays);
  const lower = source === 'PUBLIC' ? baseline : ((baseline * 4n) / 2_500n) * 500n;
  const upper = source === 'PUBLIC' ? baseline : ((baseline * 6n + 2_499n) / 2_500n) * 500n;
  const baselineKrw = KrwSchema.parse(Number(baseline));
  const minKrw = KrwSchema.parse(Number(source === 'PUBLIC' ? lower : lower < 500n ? 500n : lower));
  const maxKrw = KrwSchema.parse(Number(upper));
  return {
    billingDays,
    baselineKrw,
    minKrw,
    maxKrw,
    feeOptions: { LOWER: minKrw, STANDARD: baselineKrw, UPPER: maxKrw },
  };
}

/** Stable JSON: sorted object keys, preserved arrays; non-JSON values are rejected. */
export function canonicalJson(value: unknown): string {
  const stack = new Set<object>();
  const encode = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== 'object' || input === null)
      throw new TypeError('Canonical input must contain only JSON values.');
    if (stack.has(input)) throw new TypeError('Canonical input must not be cyclic.');
    stack.add(input);
    let result: string;
    if (Array.isArray(input)) {
      result = '[' + Array.from(input, (item) => encode(item)).join(',') + ']';
    } else {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError('Canonical input must contain plain objects.');
      const object = input as Record<string, unknown>;
      result =
        '{' +
        Object.keys(object)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(object[key]))
          .join(',') +
        '}';
    }
    stack.delete(input);
    return result;
  };
  return encode(value);
}
export function canonicalHash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))));
}
export function formatKrw(amount: number): string {
  KrwSchema.parse(amount);
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(amount) + '원';
}
const seoulFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function formatSeoulDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(UtcDateTimeSchema.parse(value));
  const parts = Object.fromEntries(
    seoulFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}. ${parts.month}. ${parts.day}. (${parts.weekday}) ${parts.hour}:${parts.minute}`;
}
