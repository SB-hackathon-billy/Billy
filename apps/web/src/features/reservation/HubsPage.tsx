// 캠퍼스 대여소 화면: 거점 위치도·거리(/hubs), 대여소별 물품(/hubs/:placeId).
// 위치는 브라우저 안에서만 계산하고 서버로 보내지 않는다.
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CAMPUS_HUB_PLACE_IDS, CatalogItemSchema, listDataSchema } from '@sb/contracts';
import { allPages } from '../../lib/pagination.js';
import { usePlaces } from '../../lib/hooks.js';
import {
  HUB_SPOTS,
  formatDistance,
  locate,
  mapUrl,
  metersTo,
  insideSeongbuk,
  useHere,
  walkMinutes,
  type Here,
} from '../../lib/campus.js';
import { ActionButton, ErrorNotice, Loading } from '../../components/ui.js';
import { CatalogCard, PhotoCredit } from './pages.js';
import SeongbukMap, { type MapHub } from './HubsMap.js';
import './reservation.css';

function useAllItems() {
  return useQuery({
    queryKey: ['catalog', 'hubs-all'],
    queryFn: ({ signal }) =>
      allPages('/catalog?limit=50', listDataSchema(CatalogItemSchema), signal),
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

/** 성북구 지도 + 범례·출처. */
function HubsMap({
  hubs,
  here,
  selected,
}: {
  hubs: ReturnType<typeof useHubs>['hubs'];
  here: Here;
  selected?: string;
}) {
  const key = hubs
    .map((h) => `${h.place.id}:${h.meters === null ? '' : Math.round(h.meters)}`)
    .join('|');
  // 같은 거점·거리면 같은 배열을 넘겨 지도 표시를 다시 그리지 않는다.
  const mapHubs = useMemo<MapHub[]>(
    () =>
      hubs.map((h) => ({ id: h.place.id, label: h.place.label, spot: h.spot, meters: h.meters })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const outside = here.status === 'ready' && !insideSeongbuk(here);
  return (
    <figure className="hubs-map">
      <div className="sb-map-frame">
        <SeongbukMap hubs={mapHubs} here={here} {...(selected ? { selected } : {})} />
      </div>
      <figcaption className="hubs-legend">
        <span>
          <i className="dot hub" /> 캠퍼스 대여소
        </span>
        <span>
          <i className="dot center" /> 1인가구 물품대여소(장위로 82)
        </span>
        {here.status === 'ready' && (
          <span>
            <i className="dot me" /> 내 위치{outside ? ' (성북구 밖)' : ''}
          </span>
        )}
      </figcaption>
      <p className="hubs-source">
        학교 위치는 지도 표시용 대략값이에요. 구·동 경계 © OpenStreetMap
      </p>
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
      allPages(
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
      <PhotoCredit urls={items.data?.items.map((item) => item.image.url)} />
    </section>
  );
}
