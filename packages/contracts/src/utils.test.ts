import { describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalJson,
  computeFeeOptions,
  formatKrw,
  formatSeoulDateTime,
  validatePeriod,
} from './utils.js';

const start = '2026-11-07T01:00:00Z';
const end = '2026-11-08T07:00:00Z';
const now = '2026-11-01T00:00:00Z';
describe('demo-fee-v1', () => {
  it('rounds a 30-hour rental to two days and each bound to 500 KRW', () => {
    expect(computeFeeOptions(1500, start, end)).toEqual({
      billingDays: 2,
      baselineKrw: 3000,
      minKrw: 2000,
      maxKrw: 4000,
      feeOptions: { LOWER: 2000, STANDARD: 3000, UPPER: 4000 },
    });
  });
  it('enforces the 500 KRW lower floor for a one-hour rental', () => {
    expect(computeFeeOptions(500, start, '2026-11-07T02:00:00Z')).toEqual({
      billingDays: 1,
      baselineKrw: 500,
      minKrw: 500,
      maxKrw: 1000,
      feeOptions: { LOWER: 500, STANDARD: 500, UPPER: 1000 },
    });
  });
  it('fixes all public options to baseline', () => {
    expect(computeFeeOptions(1500, start, end, 'PUBLIC').feeOptions).toEqual({
      LOWER: 3000,
      STANDARD: 3000,
      UPPER: 3000,
    });
  });
  it('handles exact day boundaries and the seven-day limit', () => {
    expect(computeFeeOptions(2000, start, '2026-11-08T01:00:00Z').billingDays).toBe(1);
    expect(computeFeeOptions(2000, start, '2026-11-08T01:30:00Z').billingDays).toBe(2);
    expect(computeFeeOptions(10000, start, '2026-11-14T01:00:00Z').baselineKrw).toBe(70000);
  });
  it.each([0, -500, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid daily rate %s',
    (value) => {
      expect(() => computeFeeOptions(value, start, end)).toThrow();
    },
  );
  it('rejects arithmetic overflow and invalid periods', () => {
    expect(() => computeFeeOptions(Number.MAX_SAFE_INTEGER, start, end)).toThrow();
    expect(() => computeFeeOptions(500, end, start)).toThrow();
  });
  it('agrees with the contract formula across all seed rates and half-hour durations', () => {
    for (let rate = 500; rate <= 10000; rate += 500) {
      for (let hours = 1; hours <= 168; hours += 0.5) {
        const finish = new Date(Date.parse(start) + hours * 3_600_000).toISOString();
        const result = computeFeeOptions(rate, start, finish);
        const baseline = rate * Math.ceil(hours / 24);
        expect(result.minKrw).toBe(Math.max(500, Math.floor((baseline * 0.8) / 500) * 500));
        expect(result.maxKrw).toBe(Math.ceil((baseline * 1.2) / 500) * 500);
      }
    }
  });
});
describe('period validation', () => {
  it('accepts both inclusive duration limits and half-hour times', () => {
    expect(validatePeriod(start, '2026-11-07T02:00:00Z', now).valid).toBe(true);
    expect(validatePeriod(start, '2026-11-14T01:00:00Z', now).valid).toBe(true);
    expect(validatePeriod('2026-11-07T01:30:00Z', '2026-11-07T02:30:00Z', now).valid).toBe(true);
  });
  it.each([
    [start, '2026-11-07T01:30:00Z'],
    [start, '2026-11-14T01:30:00Z'],
    ['2026-11-07T01:01:00Z', end],
    [start, '2026-11-08T07:00:01Z'],
    [end, start],
    ['invalid', end],
    ['2026-11-07T10:00:00+09:00', end],
  ])('rejects invalid interval %s — %s', (from, until) =>
    expect(validatePeriod(from, until, now).valid).toBe(false),
  );
  it('rejects starts equal to or earlier than the server clock', () => {
    expect(validatePeriod(start, end, start).valid).toBe(false);
    expect(validatePeriod(start, end, '2026-11-07T01:00:01Z').valid).toBe(false);
    expect(validatePeriod(start, end, 'invalid').valid).toBe(false);
  });
});
describe('Korean presentation', () => {
  it('formats exact date/weekday and KRW text', () => {
    expect(formatSeoulDateTime(start)).toBe('2026. 11. 7. (토) 10:00');
    expect(formatKrw(4000)).toBe('4,000원');
  });
  it('uses Seoul midnight rather than host timezone or 24:00', () => {
    expect(formatSeoulDateTime('2026-11-06T15:00:00Z')).toBe('2026. 11. 7. (토) 00:00');
  });
});
describe('canonical input hashing', () => {
  it('is stable under nested object-key reordering but preserves arrays', () => {
    expect(canonicalJson({ b: 1, a: { y: null, x: '한글' } })).toBe(
      '{"a":{"x":"한글","y":null},"b":1}',
    );
    expect(canonicalHash({ b: 2, a: [1, 2] })).toBe(canonicalHash({ a: [1, 2], b: 2 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(canonicalHash({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });
  it.each([undefined, NaN, Infinity, { lost: undefined }, new Date(), 1n])(
    'rejects non-JSON inputs',
    (value) => expect(() => canonicalHash(value)).toThrow(),
  );
  it('rejects cycles', () => {
    const value: unknown[] = [];
    value.push(value);
    expect(() => canonicalHash(value)).toThrow();
  });
});
