// 캠퍼스 대여소 화면: 거점 위치도·거리(/hubs), 대여소별 물품(/hubs/:placeId).
// 위치는 브라우저 안에서만 계산하고 서버로 보내지 않는다.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CAMPUS_HUB_PLACE_IDS, CatalogItemSchema, listDataSchema } from '@sb/contracts';
import { api } from '../../lib/api.js';
import { usePlaces } from '../../lib/hooks.js';
import {
  CENTER_SPOT,
  HUB_SPOTS,
  SEONGBUK_MAP,
  formatDistance,
  locate,
  mapUrl,
  metersTo,
  project,
  useHere,
  walkMinutes,
  type Here,
} from '../../lib/campus.js';
import { ActionButton, ErrorNotice, Loading } from '../../components/ui.js';
import { CatalogCard, PhotoCredit } from './pages.js';
import './reservation.css';

// ponytail: 물품 수는 카탈로그 첫 50개로 센다. 물품이 50개를 넘으면 대여소별 count API를 둔다.
function useAllItems() {
  return useQuery({
    queryKey: ['catalog', 'hubs-all'],
    queryFn: ({ signal }) =>
      api.get('/catalog?limit=50', listDataSchema(CatalogItemSchema), signal),
  });
}

function useHubs() {
  const places = usePlaces();
  const here = useHere();
  const hubs = (places.data?.items ?? [])
    .filter((p) => CAMPUS_HUB_PLACE_IDS.includes(p.id) && HUB_SPOTS[p.id])
    .map((p) => ({ place: p, spot: HUB_SPOTS[p.id]!, meters: metersTo(here, p.id) }))
    .sort(
      (a, b) =>
        (a.meters ?? 0) - (b.meters ?? 0) || a.place.label.localeCompare(b.place.label, 'ko'),
    );
  return { hubs, here, loading: places.isPending };
}

/** 학교 이름표 위치(점 기준). 가까운 학교끼리 겹치지 않게 방향만 정한다. */
const LABEL_SIDE: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  'place-korea': 'right',
  'place-sungshin': 'up',
  'place-hansung': 'left',
  'place-kookmin': 'up',
  'place-seokyeong': 'up',
  'place-dongduk': 'down',
};

/**
 * 성북구 지도: 실제 행정경계 위에 캠퍼스 거점 6곳과 장위동 물품대여소만 찍는다.
 * 모든 점(거점·내 위치)은 같은 투영(project)을 쓴다.
 */
function HubsMap({
  hubs,
  here,
  selected,
}: {
  hubs: ReturnType<typeof useHubs>['hubs'];
  here: Here;
  selected?: string;
}) {
  const me = here.status === 'ready' ? project(here) : null;
  const meInside =
    me && me.x > 0 && me.y > 0 && me.x < SEONGBUK_MAP.width && me.y < SEONGBUK_MAP.height;
  const nearest = hubs[0]?.meters != null ? hubs[0].place.id : null;
  const center = project(CENTER_SPOT);
  const label = (side: string, x: number, y: number) =>
    side === 'up'
      ? { x, y: y - 14, anchor: 'middle' as const }
      : side === 'down'
        ? { x, y: y + 22, anchor: 'middle' as const }
        : side === 'left'
          ? { x: x - 13, y: y + 4, anchor: 'end' as const }
          : { x: x + 13, y: y + 4, anchor: 'start' as const };
  return (
    <figure className="hubs-map">
      <svg
        className="hubs-map-svg"
        viewBox={`0 0 ${SEONGBUK_MAP.width} ${SEONGBUK_MAP.height}`}
        role="img"
        aria-label="성북구 캠퍼스 대여소 지도"
      >
        <defs>
          <filter id="hubs-shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#2b2a4a" floodOpacity="0.12" />
          </filter>
        </defs>
        <path d={SEONGBUK_MAP.path} className="sb-land" filter="url(#hubs-shadow)" />
        <text x="22" y="34" className="sb-title">
          성북구
        </text>
        <g className="sb-center">
          <rect
            x={center.x - 7}
            y={center.y - 7}
            width="14"
            height="14"
            rx="2"
            transform={`rotate(45 ${center.x} ${center.y})`}
          />
          <text x={center.x + 13} y={center.y - 10}>
            장위동 물품대여소
          </text>
        </g>
        {hubs.map((h) => {
          const { x, y } = project(h.spot);
          const state =
            selected === h.place.id
              ? 'selected'
              : !selected && nearest === h.place.id
                ? 'nearest'
                : '';
          const l = label(LABEL_SIDE[h.place.id] ?? 'up', x, y);
          return (
            <Link
              key={h.place.id}
              to={`/hubs/${h.place.id}`}
              aria-label={`${h.place.label}${h.meters !== null ? ` · ${formatDistance(h.meters)}` : ''} 물품 보기`}
            >
              <g className={`sb-pin ${state}`}>
                <circle cx={x} cy={y} r="16" className="halo" />
                <circle cx={x} cy={y} r="7" className="dot" />
                <text x={l.x} y={l.y} textAnchor={l.anchor} className="name">
                  {h.place.label.replace(' 거점', '')}
                  {h.meters !== null && <tspan className="dist"> {formatDistance(h.meters)}</tspan>}
                </text>
              </g>
            </Link>
          );
        })}
        {meInside && (
          <g className="sb-me">
            <circle cx={me.x} cy={me.y} r="13" className="halo" />
            <circle cx={me.x} cy={me.y} r="5.5" />
          </g>
        )}
      </svg>
      <figcaption className="hubs-legend">
        <span>
          <i className="dot hub" /> 캠퍼스 대여소
        </span>
        <span>
          <i className="dot center" /> 1인가구 물품대여소(장위로 82)
        </span>
        {meInside && (
          <span>
            <i className="dot me" /> 내 위치
          </span>
        )}
        {me && !meInside && <span>지금 위치는 성북구 밖이에요</span>}
      </figcaption>
      <p className="hubs-source">지도: 통계청 행정구역 경계(2013) · 학교 위치 OpenStreetMap</p>
    </figure>
  );
}

function LocateButton({ here }: { here: Here }) {
  if (here.status === 'ready') return null;
  return (
    <ActionButton secondary isDisabled={here.status === 'locating'} onPress={locate}>
      {here.status === 'locating' ? '위치 찾는 중…' : '📍 내 위치로 가까운 곳 찾기'}
    </ActionButton>
  );
}

/** /hubs: 캠퍼스 대여소 6곳의 위치·거리·물품 수. */
export function HubsPage() {
  const { hubs, here, loading } = useHubs();
  const all = useAllItems();
  const count = (placeId: string) =>
    all.data?.items.filter((i) => i.allowedPlaceIds.includes(placeId)).length;
  return (
    <section className="hubs-page">
      <p className="eyebrow">캠퍼스 대여소</p>
      <h1>
        가까운 대여소에서
        <br />
        받고 돌려줘요.
      </h1>
      <p className="lead">
        이웃 물건과 센터 물건을 캠퍼스 거점의 학생 관리자에게 받고 돌려줘요. 대여소를 누르면 그곳에
        있는 물품이 보여요.
      </p>
      {loading ? (
        <Loading />
      ) : (
        <>
          <HubsMap hubs={hubs} here={here} />
          <div className="hubs-locate">
            <LocateButton here={here} />
            {here.status === 'failed' && (
              <p className="field-hint" role="status">
                {here.reason}
              </p>
            )}
            {here.status === 'ready' && hubs[0]?.meters != null && (
              <p className="hubs-nearest" role="status">
                가장 가까운 곳은 <b>{hubs[0].place.label}</b>, {formatDistance(hubs[0].meters)} ·
                걸어서 약 {walkMinutes(hubs[0].meters)}분이에요.
              </p>
            )}
          </div>
          <ul className="hubs-list">
            {hubs.map((h, i) => (
              <li key={h.place.id}>
                <Link
                  to={`/hubs/${h.place.id}`}
                  className={`hub-card ${h.meters !== null && i === 0 ? 'nearest' : ''}`}
                >
                  <div>
                    <strong>
                      {h.place.label}
                      {h.meters !== null && i === 0 && (
                        <span className="nearby-badge">가장 가까워요</span>
                      )}
                    </strong>
                    <span>{h.place.description}</span>
                    <span className="hub-count">
                      물품 {count(h.place.id) ?? '…'}개 · 물품 보기 →
                    </span>
                  </div>
                  {h.meters !== null && (
                    <div className="nearby-meta">
                      <b>{formatDistance(h.meters)}</b>
                      <span>도보 약 {walkMinutes(h.meters)}분</span>
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <p className="field-hint">위치도와 거리는 캠퍼스 정문 부근 기준의 대략값이에요.</p>
        </>
      )}
    </section>
  );
}

/** /hubs/:placeId: 대여소 위치·지도와 이 대여소에서 빌릴 수 있는 물품. */
export function HubDetailPage() {
  const { placeId = '' } = useParams();
  const { hubs, here } = useHubs();
  const hub = hubs.find((h) => h.place.id === placeId);
  const items = useQuery({
    queryKey: ['catalog', 'hub', placeId],
    queryFn: ({ signal }) =>
      api.get(
        `/catalog?limit=50&placeId=${encodeURIComponent(placeId)}`,
        listDataSchema(CatalogItemSchema),
        signal,
      ),
  });
  if (!hub)
    return hubs.length ? (
      <ErrorNotice error={new Error('대여소를 찾을 수 없어요.')} />
    ) : (
      <Loading />
    );
  const { lat, lng } = hub.spot;
  const bbox = [lng - 0.006, lat - 0.0035, lng + 0.006, lat + 0.0035].join(',');
  return (
    <section className="hubs-page">
      <Link className="text-link" to="/hubs">
        ← 캠퍼스 대여소
      </Link>
      <p className="eyebrow">캠퍼스 대여소</p>
      <h1>{hub.place.label}</h1>
      <p className="lead">{hub.place.description}</p>
      <div className="hub-detail-meta">
        {hub.meters !== null ? (
          <span>
            📍 내 위치에서 <b>{formatDistance(hub.meters)}</b> · 걸어서 약 {walkMinutes(hub.meters)}
            분
          </span>
        ) : (
          <LocateButton here={here} />
        )}
        <a className="text-link" href={mapUrl(hub.spot)} target="_blank" rel="noreferrer">
          카카오맵에서 길찾기 →
        </a>
      </div>
      <iframe
        className="hub-map-frame"
        title={`${hub.place.label} 지도`}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <HubsMap hubs={hubs} here={here} selected={hub.place.id} />
      <h2 className="hub-items-title">
        이 대여소에서 빌릴 수 있어요{items.data ? ` · ${items.data.items.length}개` : ''}
      </h2>
      {items.isPending ? (
        <Loading />
      ) : items.error ? (
        <ErrorNotice error={items.error} />
      ) : !items.data.items.length ? (
        <p className="field-hint">아직 이 대여소에 등록된 물품이 없어요.</p>
      ) : (
        <ul className="catalog-list" aria-label={`${hub.place.label} 물품 목록`}>
          {items.data.items.map((item) => (
            <CatalogCard key={item.id} item={item} period={`?place=${hub.place.id}`} />
          ))}
        </ul>
      )}
      <PhotoCredit />
    </section>
  );
}
