// 시연용 진행 데이터. seed(기본 fixture) 뒤에 한 번 실행한다: `npm run -w @sb/db showcase`.
// 캠퍼스 거점·가격이 다른 물품을 더하고, 실제 도메인 명령으로 예약·인계·반납 상태를 만든다.
// 테스트 fixture(@sb/demo-data)는 바꾸지 않는다. seed를 다시 하면 이 데이터도 지워진다.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Item, Place, ReservationView } from '@sb/contracts';
import { centerPhotoUrl, seoulCalendarDate, seoulDateTimeToUtc } from '@sb/demo-data';
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
  {
    id: 'place-kookmin',
    label: '국민대 거점',
    description: '국민대학교 캠퍼스 안 학생 관리자 거점.',
    isDemo: true,
  },
  {
    id: 'place-dongduk',
    label: '동덕여대 거점',
    description: '동덕여자대학교 캠퍼스 안 학생 관리자 거점.',
    isDemo: true,
  },
  {
    id: 'place-seokyeong',
    label: '서경대 거점',
    description: '서경대학교 캠퍼스 안 학생 관리자 거점.',
    isDemo: true,
  },
];

/** 사진: 성북구1인가구지원센터 물품대여 페이지(공공누리 제1유형). `CENTER_PHOTO_CREDIT` 참고. */
const item = (
  itemId: string,
  title: string,
  category: Item['category'],
  dailyRateKrw: number,
  ownerId: string | null,
  allowedPlaceIds: string[],
  photo: number,
): Item => ({
  id: itemId,
  title,
  category,
  dailyRateKrw,
  ownerId,
  source: ownerId ? 'RESIDENT' : 'PUBLIC',
  image: { url: centerPhotoUrl(photo), alt: `${title} 사진`, isIllustration: false },
  enabled: true,
  allowedPlaceIds,
  pricingFacts: { registeredExtraEffort: false },
  unavailableIntervals: [],
  publicScenario: ownerId ? null : 'APPROVE',
});
const HUBS = [
  'place-hansung',
  'place-sungshin',
  'place-korea',
  'place-kookmin',
  'place-dongduk',
  'place-seokyeong',
];
let hubTurn = 0;
/** 센터 물품도 센터 앞과 캠퍼스 거점 2곳에 나눠 둔다(장소는 최대 3곳). 거점을 돌아가며 배치한다. */
const center = () => ['place-center', HUBS[hubTurn++ % 6]!, HUBS[hubTurn++ % 6]!];
/** 센터 1인가구 물품대여소 품목(센터 앞에서 수령). */
const publicItems: Item[] = [
  item('pub-humidifier', '가습기 위닉스 4L', 'CLEANING', 500, null, center(), 28),
  item('pub-airwrap', '다이슨 에어랩 멀티 스타일러', 'HOBBY', 2_000, null, center(), 23),
  item('pub-windowbot', '로봇 창문청소기 파워윈도우봇', 'CLEANING', 1_500, null, center(), 10),
  item('pub-massagegun', '마사지건 제스파 바디볼트', 'HOBBY', 1_000, null, center(), 11),
  item('pub-speaker', '블루투스 스피커 JBL Charge 5', 'HOBBY', 1_000, null, center(), 22),
  item('pub-sewing', '미니 재봉틀 혼스', 'TOOLS', 1_000, null, center(), 40),
  item('pub-cart', '접이식 카트 스탠리', 'TOOLS', 500, null, center(), 4),
  item('pub-badminton', '배드민턴 라켓 2세트 요넥스', 'HOBBY', 500, null, center(), 34),
  item('pub-iron', '핸디형 스팀다리미 보만', 'CLEANING', 500, null, center(), 35),
  item('pub-bedcleaner', '침구살균청소기 하우쎈', 'CLEANING', 1_000, null, center(), 24),
  item('pub-dehumidifier', '미니 제습기 보아르', 'CLEANING', 1_000, null, center(), 37),
  item('pub-icebox', '캠핑용 아이스박스 21L', 'TRAVEL', 500, null, center(), 48),
  item('pub-lantern', 'LED 캠핑 랜턴', 'TRAVEL', 500, null, center(), 47),
  item('pub-camptable', '캠핑 테이블 MMT-600', 'TRAVEL', 1_000, null, center(), 46),
  item('pub-campchair', '접이식 캠핑의자 2세트', 'TRAVEL', 1_000, null, center(), 45),
  item('pub-polaroid', '폴라로이드 카메라 무케 나우 플러스', 'HOBBY', 1_500, null, center(), 14),
  item('pub-laptop', '노트북 LG 15U50P', 'HOBBY', 2_000, null, center(), 1),
  item('pub-heater', '전기히터 신일전자', 'CLEANING', 1_000, null, center(), 27),
  item('pub-induction', '포터블 인덕션 LG 디오스', 'CLEANING', 1_000, null, center(), 31),
  item('pub-gopro', '고프로 액션캠', 'HOBBY', 2_000, null, center(), 44),
  item('pub-case24', '캐리어 24인치 내셔널지오그래픽', 'TRAVEL', 1_000, null, center(), 17),
];
/** 이웃 물품. 같은 청소기라도 가격이 달라 조건을 비교할 수 있다(기존 1,000원 청소기와 함께). */
const residentItems: Item[] = [
  item(
    'res-cleaner-jun',
    '준의 무선 청소기',
    'CLEANING',
    2_500,
    'u_jun',
    ['place-hansung', 'place-korea'],
    30,
  ),
  item(
    'res-cleaner-seul',
    '슬의 스팀 청소기',
    'CLEANING',
    1_800,
    'u_seul',
    ['place-sungshin', 'place-hansung'],
    15,
  ),
  item('res-ladder-jun', '준의 접이식 사다리', 'TOOLS', 1_200, 'u_jun', ['place-hansung'], 41),
  item(
    'res-speaker-seul',
    '슬의 블루투스 스피커',
    'HOBBY',
    1_000,
    'u_seul',
    ['place-sungshin', 'place-dongduk'],
    8,
  ),
  item(
    'res-headset-jun',
    '준의 노이즈캔슬링 헤드셋',
    'HOBBY',
    1_500,
    'u_jun',
    ['place-korea', 'place-kookmin'],
    2,
  ),
  item(
    'res-waffle-duri',
    '두리의 와플 메이커',
    'HOBBY',
    800,
    'u_duri',
    ['place-seokyeong', 'place-hansung'],
    39,
  ),
  item(
    'res-polaroid-duri',
    '두리의 인스탁스 미니12',
    'HOBBY',
    1_500,
    'u_duri',
    ['place-kookmin', 'place-seokyeong'],
    25,
  ),
  item(
    'res-dryer-hana',
    '하나의 휴대용 의류·신발 건조기',
    'CLEANING',
    1_200,
    'u_hana',
    ['place-hansung', 'place-center'],
    38,
  ),
  item(
    'res-mic-seul',
    '슬의 블루투스 무선마이크',
    'HOBBY',
    1_000,
    'u_seul',
    ['place-dongduk', 'place-sungshin'],
    43,
  ),
];
const items: Item[] = [...publicItems, ...residentItems];
/** 기존 물품도 캠퍼스 거점에서 주고받게 한다(장소는 최대 3곳). */
const addHansung = ['res-cleaner-duri', 'res-projector-duri', 'res-case-hana'];
/** 실제 사진이 없는 기본 물품은 시연 목록에서 뺀다(테스트 fixture에는 남는다). */
const hidden = ['res-tool-hana'];

/**
 * 거점 인계·반납 사진: 그 물품의 실제 사진(센터 물품대여 사진, 공공누리 제1유형)을 쓴다.
 * 운영 api 이미지에도 같은 폴더가 들어간다(infra/runtime.Dockerfile).
 */
const PHOTO_DIR = new URL('../../../apps/web/public/assets/items/center/', import.meta.url);
async function itemPhoto(imageUrl: string): Promise<{ contentType: string; bytes: Buffer }> {
  const file = /\/center\/(cat-type-\d+\.webp)$/.exec(imageUrl)?.[1];
  if (!file) throw new Error(`실제 사진이 없는 물품입니다: ${imageUrl}`);
  return { contentType: 'image/webp', bytes: await readFile(new URL(file, PHOTO_DIR)) };
}

export async function showcase(db: Database, now = new Date()) {
  const today = seoulCalendarDate(now);
  const day = (offset: number) =>
    seoulCalendarDate(Date.parse(`${today}T12:00:00+09:00`) + offset * DAY);
  const at = (offset: number, time: string) => seoulDateTimeToUtc(day(offset), time);
  const when = (offset: number, time: string) => new Date(at(offset, time));

  await db.transaction(async (u) => {
    // migration 006이 넣은 거점과 겹쳐도 된다.
    for (const place of places)
      await u.c.query(
        'INSERT INTO places(id,data) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data',
        [place.id, place],
      );
    for (const it of items) await put(u.c, 'items', it, true);
    await u.c.query(
      `UPDATE items SET data = jsonb_set(data, '{allowedPlaceIds}', (data->'allowedPlaceIds') || '"place-hansung"')
       WHERE id = ANY($1::text[]) AND NOT (data->'allowedPlaceIds' ? 'place-hansung')`,
      [addHansung],
    );
    await u.c.query(
      `UPDATE items SET data = jsonb_set(data, '{enabled}', 'false') WHERE id = ANY($1::text[])`,
      [hidden],
    );
    // 기본 seed의 공공 물품도 거점 2곳에 더 둔다.
    for (const itemId of ['pub-projector', 'pub-cleaner', 'pub-ladder', 'pub-case'])
      await u.c.query(
        `UPDATE items SET data = jsonb_set(data, '{allowedPlaceIds}', $2) WHERE id = $1`,
        [itemId, JSON.stringify(center())],
      );
  });

  const photo = (imageUrl: string) =>
    db.transaction(async (u) => {
      const photoId = id('img');
      const { contentType, bytes } = await itemPhoto(imageUrl);
      await u.c.query(
        "INSERT INTO item_images(id,owner_id,content_type,bytes) VALUES($1,'u_hub',$2,$3)",
        [photoId, contentType, bytes],
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
    const photoId = await photo(v.reservation.item.image.url);
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
  const returnPhoto = await photo(pastPicked.reservation.item.image.url);
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
  await reserve('u_seul', 'res-dryer-hana', 'place-hansung', [1, '13:00'], [2, '13:00'], now);

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
      `Showcase: 캠퍼스 거점 6곳, 물품 ${items.length}개, 예약 5건(인계 대기·응답 대기·반납 완료·승인 대기·대여 중).`,
    );
  } finally {
    await db.close();
  }
}
