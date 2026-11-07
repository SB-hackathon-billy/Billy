import { describe, expect, it } from 'vitest';
import { ItemSchema } from '@sb/contracts';
import { buildSeed, defaultRequestPeriod, seoulCalendarDate, seoulDateTimeToUtc } from './index.js';

const now = '2026-11-01T01:00:00Z';
describe('contract §14 fixtures', () => {
  it('provides the exact users, items, rates, sources, and owners', () => {
    const seed = buildSeed({ now });
    expect(seed.users.map((user) => [user.id, user.handle, user.displayName])).toEqual([
      ['u_hana', 'demo-hana', '하나'],
      ['u_duri', 'demo-duri', '두리'],
      ['u_seul', 'demo-seul', '슬'],
      ['u_jun', 'demo-jun', '준'],
      ['u_bom', 'demo-bom', '봄'],
      ['u_hub', 'demo-hub', '거점 관리자'],
    ]);
    expect(
      seed.items.map((item) => [
        item.id,
        item.source,
        item.category,
        item.dailyRateKrw,
        item.ownerId,
      ]),
    ).toEqual([
      ['pub-projector', 'PUBLIC', 'HOBBY', 1500, null],
      ['pub-cleaner', 'PUBLIC', 'CLEANING', 1000, null],
      ['pub-ladder', 'PUBLIC', 'TOOLS', 500, null],
      ['pub-case', 'PUBLIC', 'TRAVEL', 1000, null],
      ['res-projector-duri', 'RESIDENT', 'HOBBY', 2000, 'u_duri'],
      ['res-cleaner-duri', 'RESIDENT', 'CLEANING', 1000, 'u_duri'],
      ['res-projector-seul', 'RESIDENT', 'HOBBY', 1500, 'u_seul'],
      ['res-case-seul', 'RESIDENT', 'TRAVEL', 1000, 'u_seul'],
      ['res-tool-hana', 'RESIDENT', 'TOOLS', 1000, 'u_hana'],
      ['res-case-hana', 'RESIDENT', 'TRAVEL', 1000, 'u_hana'],
    ]);
    expect(seed.places.map((place) => place.id)).toEqual([
      'place-center',
      'place-station',
      'place-library',
    ]);
  });
  it('uses a blocked public case, disabled resident case, and required allowed places', () => {
    const seed = buildSeed({ now });
    const items = Object.fromEntries(seed.items.map((item) => [item.id, item]));
    expect(items['pub-case']!.unavailableIntervals).toEqual([defaultRequestPeriod(now)]);
    expect(items['res-case-seul']!.enabled).toBe(false);
    expect(items['pub-ladder']!.publicScenario).toBe('DECLINE');
    expect(items['res-projector-duri']!.allowedPlaceIds).toEqual(['place-center', 'place-library']);
    expect(items['res-projector-seul']!.allowedPlaceIds).toEqual([
      'place-station',
      'place-library',
    ]);
    for (const item of seed.items.filter((item) => item.source === 'PUBLIC'))
      expect(item.allowedPlaceIds).toEqual(['place-center']);
    expect(
      seed.items.some(
        (item) => item.source === 'RESIDENT' && item.pricingFacts.registeredExtraEffort,
      ),
    ).toBe(true);
    for (const item of seed.items) {
      expect(ItemSchema.safeParse(item).success).toBe(true);
      // 센터 사진이 있으면 사진, 없으면 물품별 일러스트(명세 0007 시연 데이터).
      expect(item.image.url).toMatch(
        item.image.isIllustration
          ? new RegExp(`^/assets/items/${item.id}\\.svg$`)
          : /^\/assets\/items\/center\/cat-type-\d+\.webp$/,
      );
      expect(item.allowedPlaceIds.every((id) => seed.places.some((place) => place.id === id))).toBe(
        true,
      );
    }
  });
  it('does not mutate shared fixture state', () => {
    const first = buildSeed({ now });
    first.users[0]!.displayName = 'changed';
    first.items[0]!.allowedPlaceIds.push('invalid');
    expect(buildSeed({ now }).users[0]!.displayName).toBe('하나');
    expect(buildSeed({ now }).items[0]!.allowedPlaceIds).toEqual(['place-center']);
  });
  it('implements all three scenarios and timings', () => {
    expect(buildSeed({ now }).scenario.timing).toEqual({
      rootMs: 86_400_000,
      responseMs: 86_400_000,
      offerMs: 1_800_000,
      holdMs: 600_000,
      quoteMs: 300_000,
    });
    const fast = buildSeed({ now, scenario: 'expiry-fast' });
    expect(fast.scenario.timing).toEqual({
      rootMs: 90_000,
      responseMs: 90_000,
      offerMs: 30_000,
      holdMs: 30_000,
      quoteMs: 300_000,
    });
    expect(fast.users.every((user) => user.demoEligible)).toBe(true);
    expect(
      buildSeed({ now, scenario: 'ineligible' })
        .users.filter((user) => !user.demoEligible)
        .map((user) => user.id),
    ).toEqual(['u_jun']);
  });
});
describe('Seoul seed-day helpers', () => {
  it('returns the 30-hour future default period', () =>
    expect(defaultRequestPeriod(now)).toEqual({
      startAt: '2026-11-03T01:00:00.000Z',
      endAt: '2026-11-04T07:00:00.000Z',
    }));
  it('changes day at KST midnight and handles month/year rollover', () => {
    expect(seoulCalendarDate('2026-11-01T14:59:59Z')).toBe('2026-11-01');
    expect(seoulCalendarDate('2026-11-01T15:00:00Z')).toBe('2026-11-02');
    expect(defaultRequestPeriod('2026-12-30T15:00:00Z')).toEqual({
      startAt: '2027-01-02T01:00:00.000Z',
      endAt: '2027-01-03T07:00:00.000Z',
    });
  });
  it('converts explicit Seoul date/time with validation', () => {
    expect(seoulDateTimeToUtc('2026-11-07', '10:00')).toBe('2026-11-07T01:00:00.000Z');
    expect(() => seoulDateTimeToUtc('2026-02-30', '10:00')).toThrow();
    expect(() => seoulDateTimeToUtc('2026-11-07', '24:00')).toThrow();
    expect(() => defaultRequestPeriod('invalid')).toThrow();
  });
});
