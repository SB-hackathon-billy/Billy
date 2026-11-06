// 가까운 캠퍼스 대여소 안내: 현재 위치에서 각 캠퍼스 거점까지의 거리. 위치는 서버로 보내지 않는다.
import { Link } from 'react-router-dom';
import { CAMPUS_HUB_PLACE_IDS } from '@sb/contracts';
import { usePlaces } from '../../lib/hooks.js';
import {
  HUB_SPOTS,
  formatDistance,
  locate,
  mapUrl,
  metersTo,
  useHere,
  walkMinutes,
} from '../../lib/campus.js';
import { ActionButton } from '../../components/ui.js';
import './reservation.css';

export function NearbyHubs({ limit = 3 }: { limit?: number }) {
  const places = usePlaces();
  const here = useHere();
  const hubs = (places.data?.items ?? [])
    .filter((p) => CAMPUS_HUB_PLACE_IDS.includes(p.id) && HUB_SPOTS[p.id])
    .map((p) => ({
      place: p,
      spot: HUB_SPOTS[p.id]!,
      meters: metersTo(here, p.id),
    }))
    .sort(
      (a, b) =>
        (a.meters ?? 0) - (b.meters ?? 0) || a.place.label.localeCompare(b.place.label, 'ko'),
    );
  if (!hubs.length) return null;
  const shown = hubs.slice(0, limit);
  const nearest = hubs[0]!;

  return (
    <section className="nearby-hubs" aria-labelledby="nearby-hubs-title">
      <div className="nearby-head">
        <div>
          <h2 id="nearby-hubs-title">가까운 캠퍼스 대여소</h2>
          <p className="field-hint">
            {here.status === 'ready'
              ? `가장 가까운 곳은 ${nearest.place.label}, ${formatDistance(nearest.meters!)}예요.`
              : '이웃 물건은 캠퍼스 거점에서 학생 관리자에게 받고 돌려줘요.'}
          </p>
        </div>
        {here.status !== 'ready' && (
          <ActionButton secondary isDisabled={here.status === 'locating'} onPress={locate}>
            {here.status === 'locating' ? '찾는 중…' : '📍 내 위치로 찾기'}
          </ActionButton>
        )}
      </div>
      {here.status === 'failed' && (
        <p className="field-hint" role="status">
          {here.reason}
        </p>
      )}
      <ul className="nearby-list">
        {shown.map(({ place, spot, meters }, i) => (
          <li key={place.id} className={meters !== null && i === 0 ? 'nearest' : undefined}>
            <div>
              <Link to={`/hubs/${place.id}`} className="nearby-link">
                <strong>
                  {place.label}
                  {meters !== null && i === 0 && (
                    <span className="nearby-badge">가장 가까워요</span>
                  )}
                </strong>
              </Link>
              <span>{place.description}</span>
            </div>
            <div className="nearby-meta">
              {meters !== null && (
                <>
                  <b>{formatDistance(meters)}</b>
                  <span>걸어서 약 {walkMinutes(meters)}분</span>
                </>
              )}
              <a href={mapUrl(spot)} target="_blank" rel="noreferrer">
                지도
              </a>
            </div>
          </li>
        ))}
      </ul>
      <Link className="button secondary nearby-all" to="/hubs">
        캠퍼스 대여소 {hubs.length}곳 위치·물품 보기 →
      </Link>
      {here.status === 'ready' && (
        <p className="field-hint nearby-note">직선거리 기준이라 실제 걷는 거리와 조금 달라요.</p>
      )}
    </section>
  );
}

function PinIcon() {
  return (
    <svg className="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

/** 장소 id들을 가까운 순으로(위치를 모르면 원래 순서로). */
function useSortedPlaces(placeIds: readonly string[]) {
  const places = usePlaces();
  const here = useHere();
  return placeIds
    .map((id, i) => ({
      id,
      i,
      label: places.data?.items.find((p) => p.id === id)?.label ?? id,
      meters: metersTo(here, id),
    }))
    .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.i - b.i);
}

/** 둘러보기 카드의 한 줄: 가장 가까운 대여소(거리) 외 N곳. */
export function ItemPlacesLine({ placeIds }: { placeIds: readonly string[] }) {
  const sorted = useSortedPlaces(placeIds);
  const first = sorted[0];
  if (!first) return null;
  // 위치를 알면 가장 가까운 곳과 거리, 모르면 두 곳까지 이름을 보여 준다.
  const shown = first.meters !== null ? [first] : sorted.slice(0, 2);
  const rest = sorted.length - shown.length;
  return (
    <span className="item-places">
      <PinIcon />
      {shown.map((p) => p.label).join(' · ')}
      {first.meters !== null && ` ${formatDistance(first.meters)}`}
      {rest > 0 && ` 외 ${rest}곳`}
    </span>
  );
}

/** 물품 상세: 이 물품을 빌릴 수 있는 대여소 목록. 누르면 그곳에서 받도록 고른다. */
export function ItemPlacesList({
  placeIds,
  selected,
  onSelect,
}: {
  placeIds: readonly string[];
  selected?: string;
  onSelect?: (placeId: string) => void;
}) {
  const here = useHere();
  const sorted = useSortedPlaces(placeIds);
  return (
    <section className="item-places-list" aria-labelledby="item-places-title">
      <div className="nearby-head">
        <h2 id="item-places-title">빌릴 수 있는 대여소 {sorted.length}곳</h2>
        {here.status !== 'ready' && (
          <ActionButton secondary isDisabled={here.status === 'locating'} onPress={locate}>
            {here.status === 'locating' ? '찾는 중…' : '📍 거리 보기'}
          </ActionButton>
        )}
      </div>
      <ul className="nearby-list">
        {sorted.map((p, i) => {
          const spot = HUB_SPOTS[p.id];
          return (
            <li key={p.id} className={selected === p.id ? 'nearest' : undefined}>
              <div>
                <strong>
                  {p.label}
                  {p.meters !== null && i === 0 && (
                    <span className="nearby-badge">가장 가까워요</span>
                  )}
                </strong>
                {p.meters !== null && (
                  <span>
                    {formatDistance(p.meters)} · 걸어서 약 {walkMinutes(p.meters)}분
                  </span>
                )}
              </div>
              <div className="nearby-meta">
                {onSelect && (
                  <button
                    type="button"
                    className="text-link"
                    aria-pressed={selected === p.id}
                    onClick={() => onSelect(p.id)}
                  >
                    {selected === p.id ? '여기서 받기 ✓' : '여기서 받기'}
                  </button>
                )}
                {spot && (
                  <a href={mapUrl(spot)} target="_blank" rel="noreferrer">
                    지도
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
