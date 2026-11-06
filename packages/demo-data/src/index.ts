import { z } from 'zod';
import {
  DemoScenarioSchema,
  DemoUserSchema,
  ItemSchema,
  LIMITS,
  PlaceSchema,
  TIMING,
  type Category,
  type DemoScenario,
  type Item,
  type Period,
} from '@sb/contracts';

export { TIMING, LIMITS } from '@sb/contracts';
export const MAX_CANDIDATES = LIMITS.maxCandidates;
export const MAX_CHANGES = LIMITS.maxChanges;
export const DEFAULT_TIMING = TIMING;
export const EXPIRY_FAST_TIMING = Object.freeze({
  ...TIMING,
  rootMs: 90_000,
  responseMs: 90_000,
  offerMs: 30_000,
  holdMs: 30_000,
});
export const SeedTimingSchema = z
  .object({
    rootMs: z.number().int().positive(),
    responseMs: z.number().int().positive(),
    offerMs: z.number().int().positive(),
    holdMs: z.number().int().positive(),
    quoteMs: z.number().int().positive(),
  })
  .strict();
export const SeedDataSchema = z
  .object({
    users: z.array(DemoUserSchema).length(5),
    places: z.array(PlaceSchema).length(3),
    items: z.array(ItemSchema).length(10),
    scenario: z.object({ name: DemoScenarioSchema, timing: SeedTimingSchema }).strict(),
  })
  .strict();
export type SeedData = z.infer<typeof SeedDataSchema>;
export type SeedTiming = z.infer<typeof SeedTimingSchema>;

const seoulDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function asDate(now: Date | string | number): Date {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('유효한 seed 실행 시각이 필요합니다.');
  return date;
}
export function seoulCalendarDate(now: Date | string | number): string {
  const parts = Object.fromEntries(
    seoulDayFormatter.formatToParts(asDate(now)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
/** Converts an explicit Korea calendar date/time; independent of the host time zone. */
export function seoulDateTimeToUtc(day: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new RangeError('날짜 YYYY-MM-DD와 시각 HH:mm이 필요합니다.');
  const date = asDate(`${day}T${time}:00+09:00`);
  if (seoulCalendarDate(date) !== day) throw new RangeError('존재하지 않는 서울 날짜입니다.');
  return date.toISOString();
}
export function defaultRequestPeriod(now: Date | string | number = new Date()): Period {
  const day = seoulCalendarDate(now);
  const midnight = Date.parse(`${day}T00:00:00+09:00`);
  return {
    startAt: new Date(midnight + (2 * 24 + 10) * 3_600_000).toISOString(),
    endAt: new Date(midnight + (3 * 24 + 16) * 3_600_000).toISOString(),
  };
}
export function buildSeed({
  scenario = 'default',
  now = new Date(),
}: { scenario?: DemoScenario; now?: Date | string | number } = {}): SeedData {
  DemoScenarioSchema.parse(scenario);
  const period = defaultRequestPeriod(now);
  const users = [
    { id: 'u_hana', handle: 'demo-hana', displayName: '하나', demoEligible: true },
    { id: 'u_duri', handle: 'demo-duri', displayName: '두리', demoEligible: true },
    { id: 'u_seul', handle: 'demo-seul', displayName: '슬', demoEligible: true },
    { id: 'u_jun', handle: 'demo-jun', displayName: '준', demoEligible: scenario !== 'ineligible' },
    // 거점 관리자(명세 0007). 물품을 소유하지 않고 인계·반납만 기록한다.
    { id: 'u_hub', handle: 'demo-hub', displayName: '거점 관리자', demoEligible: true },
  ];
  const places = [
    {
      id: 'place-center',
      label: '센터 앞',
      description: '센터 앞을 가정한 가상 시연 장소입니다. 실제 장소 사용 승인을 뜻하지 않습니다.',
      isDemo: true as const,
    },
    {
      id: 'place-station',
      label: '역 앞',
      description: '역 앞을 가정한 가상 시연 장소입니다.',
      isDemo: true as const,
    },
    {
      id: 'place-library',
      label: '도서관 앞',
      description: '도서관 앞을 가정한 가상 시연 장소입니다.',
      isDemo: true as const,
    },
  ];
  const item = (
    id: string,
    title: string,
    category: Category,
    dailyRateKrw: number,
    ownerId: string | null,
    allowedPlaceIds: string[],
    options: Partial<
      Pick<Item, 'enabled' | 'pricingFacts' | 'unavailableIntervals' | 'publicScenario'>
    > = {},
  ): Item => ({
    id,
    title,
    category,
    dailyRateKrw,
    ownerId,
    source: ownerId === null ? 'PUBLIC' : 'RESIDENT',
    image: { url: `/assets/items/${id}.svg`, alt: `${title} 데모 일러스트`, isIllustration: true },
    enabled: true,
    allowedPlaceIds,
    pricingFacts: { registeredExtraEffort: false },
    unavailableIntervals: [],
    publicScenario: ownerId === null ? 'APPROVE' : null,
    ...options,
  });
  const items: Item[] = [
    item('pub-projector', '공공 프로젝터', 'HOBBY', 1_500, null, ['place-center']),
    item('pub-cleaner', '공공 청소기', 'CLEANING', 1_000, null, ['place-center']),
    item('pub-ladder', '공공 사다리', 'TOOLS', 500, null, ['place-center'], {
      publicScenario: 'DECLINE',
    }),
    item('pub-case', '공공 여행 가방', 'TRAVEL', 1_000, null, ['place-center'], {
      unavailableIntervals: [{ ...period }],
    }),
    item(
      'res-projector-duri',
      '두리의 프로젝터',
      'HOBBY',
      2_000,
      'u_duri',
      ['place-center', 'place-library'],
      { pricingFacts: { registeredExtraEffort: true } },
    ),
    item('res-cleaner-duri', '두리의 청소기', 'CLEANING', 1_000, 'u_duri', [
      'place-center',
      'place-library',
    ]),
    item('res-projector-seul', '슬의 프로젝터', 'HOBBY', 1_500, 'u_seul', [
      'place-station',
      'place-library',
    ]),
    item(
      'res-case-seul',
      '슬의 여행 가방',
      'TRAVEL',
      1_000,
      'u_seul',
      ['place-station', 'place-library'],
      { enabled: false },
    ),
    item('res-tool-hana', '하나의 공구 세트', 'TOOLS', 1_000, 'u_hana', [
      'place-center',
      'place-station',
    ]),
    item('res-case-hana', '하나의 여행 가방', 'TRAVEL', 1_000, 'u_hana', [
      'place-center',
      'place-library',
    ]),
  ];
  return SeedDataSchema.parse({
    users,
    places,
    items,
    scenario: {
      name: scenario,
      timing: scenario === 'expiry-fast' ? EXPIRY_FAST_TIMING : DEFAULT_TIMING,
    },
  });
}
