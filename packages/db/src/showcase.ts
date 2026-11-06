// 시연용 진행 데이터. seed(기본 fixture) 뒤에 한 번 실행한다: `npm run -w @sb/db showcase`.
// 캠퍼스 거점·가격이 다른 물품을 더하고, 실제 도메인 명령으로 예약·인계·반납 상태를 만든다.
// 테스트 fixture(@sb/demo-data)는 바꾸지 않는다. seed를 다시 하면 이 데이터도 지워진다.
import { pathToFileURL } from 'node:url';
import type { Item, Place, ReservationView } from '@sb/contracts';
import { seoulCalendarDate, seoulDateTimeToUtc } from '@sb/demo-data';
import { Database } from './database.js';
import {
  createReservation,
  recordInspection,
  recordPickup,
  recordReturn,
  respondReservation,
} from './reservations.js';
import { id, put } from './storage.js';

const DAY = 24 * 3_600_000;

const places: Place[] = [
  {
    id: 'place-hansung',
    label: '한성대 거점',
    description: '한성대학교 캠퍼스 안 학생 관리자 거점. 평일 저녁·주말 낮에 인계·반납해요.',
    isDemo: true,
  },
  {
    id: 'place-sungshin',
    label: '성신여대 거점',
    description: '성신여자대학교 캠퍼스 안 학생 관리자 거점.',
    isDemo: true,
  },
  {
    id: 'place-korea',
    label: '고려대 거점',
    description: '고려대학교 캠퍼스 안 학생 관리자 거점.',
    isDemo: true,
  },
];

const item = (
  itemId: string,
  title: string,
  category: Item['category'],
  dailyRateKrw: number,
  ownerId: string,
  allowedPlaceIds: string[],
  image: string,
): Item => ({
  id: itemId,
  title,
  category,
  dailyRateKrw,
  ownerId,
  source: 'RESIDENT',
  image: { url: `/assets/items/${image}.svg`, alt: `${title} 일러스트`, isIllustration: true },
  enabled: true,
  allowedPlaceIds,
  pricingFacts: { registeredExtraEffort: false },
  unavailableIntervals: [],
  publicScenario: null,
});
/** 같은 청소기라도 가격이 달라 조건을 비교할 수 있다(기존 1,000원 청소기와 함께). */
const items: Item[] = [
  item(
    'res-cleaner-jun',
    '준의 무선 청소기',
    'CLEANING',
    2_500,
    'u_jun',
    ['place-hansung', 'place-korea'],
    'res-cleaner-duri',
  ),
  item(
    'res-cleaner-seul',
    '슬의 스팀 청소기',
    'CLEANING',
    1_800,
    'u_seul',
    ['place-sungshin', 'place-hansung'],
    'pub-cleaner',
  ),
  item(
    'res-ladder-jun',
    '준의 접이식 사다리',
    'TOOLS',
    1_200,
    'u_jun',
    ['place-hansung'],
    'pub-ladder',
  ),
];
/** 기존 물품도 캠퍼스 거점에서 주고받게 한다(장소는 최대 3곳). */
const addHansung = ['res-cleaner-duri', 'res-projector-duri', 'res-tool-hana', 'res-case-hana'];

/** 인계·반납 사진 대신 쓰는 단순 일러스트. */
const photoSvg = (label: string, scratch: boolean) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f4f4ef"/><rect x="80" y="60" width="160" height="120" rx="12" fill="#cfe59a"/>${scratch ? '<path d="M110 150h90" stroke="#555" stroke-width="5"/>' : ''}<text x="160" y="215" font-size="18" text-anchor="middle" fill="#555">${label}</text></svg>`,
  );

export async function showcase(db: Database, now = new Date()) {
  const today = seoulCalendarDate(now);
  const day = (offset: number) =>
    seoulCalendarDate(Date.parse(`${today}T12:00:00+09:00`) + offset * DAY);
  const at = (offset: number, time: string) => seoulDateTimeToUtc(day(offset), time);
  const when = (offset: number, time: string) => new Date(at(offset, time));

  await db.transaction(async (u) => {
    for (const place of places) await put(u.c, 'places', place, true);
    for (const it of items) await put(u.c, 'items', it, true);
    await u.c.query(
      `UPDATE items SET data = jsonb_set(data, '{allowedPlaceIds}', (data->'allowedPlaceIds') || '"place-hansung"')
       WHERE id = ANY($1::text[]) AND NOT (data->'allowedPlaceIds' ? 'place-hansung')`,
      [addHansung],
    );
  });

  const photo = (label: string, scratch = false) =>
    db.transaction(async (u) => {
      const photoId = id('img');
      await u.c.query(
        "INSERT INTO item_images(id,owner_id,content_type,bytes) VALUES($1,'u_hub','image/svg+xml',$2)",
        [photoId, photoSvg(label, scratch)],
      );
      return photoId;
    });
  const reserve = (
    who: string,
    itemId: string,
    placeId: string,
    start: [number, string],
    end: [number, string],
    asOf: Date,
  ) =>
    db.transaction(
      (u) =>
        createReservation(u, who, {
          itemId,
          placeId,
          startAt: at(...start),
          endAt: at(...end),
        }),
      asOf,
    );
  const approve = (owner: string, v: ReservationView, asOf: Date) =>
    db.transaction(
      (u) =>
        respondReservation(u, owner, v.reservation.id, {
          action: 'APPROVE',
          expectedVersion: v.reservation.version,
        }),
      asOf,
    );
  // 소유자 화면에는 코드가 빠지므로 원장에서 읽는다.
  const codeOf = async (reservationId: string) =>
    (
      await db.pool.query(
        "SELECT data->'handover'->>'code' AS code FROM reservations WHERE id=$1",
        [reservationId],
      )
    ).rows[0].code as string;
  const pickup = async (v: ReservationView, asOf: Date) => {
    const photoId = await photo('대여 전');
    const code = await codeOf(v.reservation.id);
    return db.transaction(
      (u) =>
        recordPickup(u, 'u_hub', code, {
          expectedVersion: v.reservation.version,
          photoId,
        }),
      asOf,
    );
  };

  // 빌리기(하나) ① 확정 · 인계 대기: 예약 화면에 QR이 바로 보인다.
  const qr = await reserve(
    'u_hana',
    'res-cleaner-jun',
    'place-hansung',
    [1, '10:00'],
    [1, '18:00'],
    now,
  );
  await approve('u_jun', qr, now);

  // 빌리기(하나) ② 소유자 응답 대기(24시간 안에 응답하지 않으면 만료).
  await reserve('u_hana', 'res-cleaner-seul', 'place-sungshin', [2, '10:00'], [3, '10:00'], now);

  // 빌리기(하나) ③ 지난주 대여 · 반납 완료(AI 비교 → 관리자 문제 없음).
  const past = await reserve(
    'u_hana',
    'res-ladder-jun',
    'place-hansung',
    [-3, '10:00'],
    [-3, '18:00'],
    when(-4, '09:00'),
  );
  const pastOk = await approve('u_jun', past, when(-4, '10:00'));
  const pastPicked = await pickup(pastOk, when(-3, '10:10'));
  const returnPhoto = await photo('반납');
  const pastReturned = await db.transaction(
    (u) =>
      recordReturn(
        u,
        'u_hub',
        pastPicked.reservation.handover!.code!,
        { expectedVersion: pastPicked.reservation.version, photoId: returnPhoto },
        async () => ({
          status: 'DONE',
          summary: '눈에 띄게 달라진 부분이 없어요.',
          differences: [],
        }),
      ),
    when(-3, '17:50'),
  );
  await db.transaction(
    (u) =>
      recordInspection(u, 'u_hub', pastReturned.reservation.handover!.code!, {
        expectedVersion: pastReturned.reservation.version,
        result: 'OK',
      }),
    when(-3, '18:00'),
  );

  // 빌려주기(하나) ④ 슬의 신청 · 하나가 승인할 차례.
  await reserve('u_seul', 'res-tool-hana', 'place-hansung', [1, '13:00'], [2, '13:00'], now);

  // 빌려주기(하나) ⑤ 준에게 빌려준 여행 가방 · 대여 중(거점에서 인계 완료).
  const lent = await reserve(
    'u_jun',
    'res-case-hana',
    'place-hansung',
    [-1, '10:00'],
    [2, '10:00'],
    when(-2, '09:00'),
  );
  const lentOk = await approve('u_hana', lent, when(-2, '11:00'));
  await pickup(lentOk, when(-1, '10:05'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new Database();
  try {
    await showcase(db);
    console.log(
      'Showcase: 캠퍼스 거점 3곳, 물품 3개, 예약 5건(인계 대기·응답 대기·반납 완료·승인 대기·대여 중).',
    );
  } finally {
    await db.close();
  }
}
