import { describe, expect, it } from 'vitest';
import { formatKrw, formatSeoulDateTime } from './api.js';
import { durationLabel, secondsRemaining, statusLabel } from './presentation.js';

describe('Korean display contract', () => {
  it('uses Seoul time and integer Korean won', () => {
    expect(formatSeoulDateTime('2026-11-07T01:00:00Z')).toBe('2026. 11. 7. (토) 10:00');
    expect(formatKrw(4000)).toBe('4,000원');
  });
  it('never describes a preview or an unknown enum as a completed rental', () => {
    expect(statusLabel('OFFERED')).toBe('조건 도착');
    expect(statusLabel('SELECTED')).toBe('선택됨');
    expect(statusLabel('PAYMENT_PREVIEW_READY')).toBe('결제 화면 준비 완료');
    expect(statusLabel('PAYMENT_COMPLETED')).toBe('상태 확인 필요');
  });
  it('expires at the server deadline and clamps negative countdowns', () => {
    const end = '2026-11-07T01:10:00Z';
    expect(secondsRemaining(end, Date.parse(end) - 600_000)).toBe(600);
    expect(secondsRemaining(end, Date.parse(end))).toBe(0);
    expect(secondsRemaining(end, Date.parse(end) + 5000)).toBe(0);
    expect(durationLabel(65)).toBe('1분 05초');
  });
});
