// 캠퍼스 대여소 화면: 거점 위치도·거리(/hubs), 대여소별 물품(/hubs/:placeId).
// 위치는 브라우저 안에서만 계산하고 서버로 보내지 않는다.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CAMPUS_HUB_PLACE_IDS, CatalogItemSchema, listDataSchema } from '@sb/contracts';
import { api } from '../../lib/api.js';
import { usePlaces } from '../../lib/hooks.js';
import {
  HUB_SPOTS,
  formatDistance,
  locate,
  mapUrl,
  metersTo,
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

/** 거점 위치도: 실제 위경도를 상자에 맞춰 찍은 점 지도. 내 위치가 가까우면 함께 보인다. */
function HubsMap({
  hubs,
  here,
  selected,
}: {
  hubs: ReturnType<typeof useHubs>['hubs'];
  here: Here;
  selected?: string;
}) {
  const me =
    here.status === 'ready' && hubs.some((h) => (h.meters ?? Infinity) < 5_000) ? here : null;
  const points = [...hubs.map((h) => h.spot), ...(me ? [me] : [])];
  const lat = points.map((p) => p.lat);
  const lng = points.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [
    Math.min(...lat),
    Math.max(...lat),
    Math.min(...lng),
    Math.max(...lng),
  ];
  const W = 320;
  const H = 220;
  const pad = 34;
  // 위도 1도와 경도 1도의 실제 거리 비율(서울 부근 약 0.79)을 맞춰 모양이 찌그러지지 않게 한다.
  const kx = 0.79;
  const span = Math.max((maxLng - minLng) * kx, (maxLat - minLat) * (W / H), 1e-6);
  const scale = (W - pad * 2) / span;
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  const x = (p: { lng: number }) => W / 2 + (p.lng - cx) * kx * scale;
  const y = (p: { lat: number }) => H / 2 - (p.lat - cy) * scale;
  return (
    <svg
      className="hubs-map"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="캠퍼스 대여소 위치도"
    >
      <rect width={W} height={H} rx="20" className="hubs-map-bg" />
      <path
        d={`M0 ${H * 0.62} C ${W * 0.3} ${H * 0.5}, ${W * 0.6} ${H * 0.78}, ${W} ${H * 0.6}`}
        className="hubs-map-road"
      />
      <path
        d={`M${W * 0.42} 0 C ${W * 0.48} ${H * 0.4}, ${W * 0.38} ${H * 0.7}, ${W * 0.46} ${H}`}
        className="hubs-map-road"
      />
      {hubs.map((h) => (
        <Link key={h.place.id} to={`/hubs/${h.place.id}`} aria-label={`${h.place.label} 물품 보기`}>
          <g className={`hubs-map-pin ${selected === h.place.id ? 'selected' : ''}`}>
            <circle cx={x(h.spot)} cy={y(h.spot)} r={selected === h.place.id ? 11 : 8} />
            <text x={x(h.spot)} y={y(h.spot) - 15} textAnchor="middle">
              {h.place.label.replace(' 거점', '')}
            </text>
          </g>
        </Link>
      ))}
      {me && (
        <g className="hubs-map-me">
          <circle cx={x(me)} cy={y(me)} r="14" className="halo" />
          <circle cx={x(me)} cy={y(me)} r="6" />
          <text x={x(me)} y={y(me) + 24} textAnchor="middle">
            나
          </text>
        </g>
      )}
    </svg>
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
