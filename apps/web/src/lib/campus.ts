// 캠퍼스 거점 위치와 거리 계산. 위치는 브라우저 안에서만 쓰고 서버로 보내지 않는다.
// 거점 좌표: OpenStreetMap(Nominatim) 학교 위치(2026-11-06 확인). 구 경계에 붙은 학교(고려대·서경대·한성대)는
// 지도에서 성북구 안쪽에 보이도록 경계에서 250m 안쪽으로 옮겼다(이동 130~180m). 거점이 데이터로 늘면 Place에 좌표를 둔다.

import { useEffect, useSyncExternalStore } from 'react';
import { SEONGBUK_BOUNDARY } from './seongbuk-boundary.js';

export interface HubSpot {
  lat: number;
  lng: number;
  /** 지도 검색어. */
  mapQuery: string;
}

export const HUB_SPOTS: Record<string, HubSpot> = {
  'place-korea': { lat: 37.5888, lng: 127.0314, mapQuery: '고려대학교 서울캠퍼스' },
  'place-kookmin': { lat: 37.6115, lng: 126.9964, mapQuery: '국민대학교' },
  'place-dongduk': { lat: 37.6065, lng: 127.0419, mapQuery: '동덕여자대학교' },
  'place-seokyeong': { lat: 37.6134, lng: 127.0132, mapQuery: '서경대학교' },
  'place-sungshin': { lat: 37.5914, lng: 127.0222, mapQuery: '성신여자대학교' },
  'place-hansung': { lat: 37.5837, lng: 127.0109, mapQuery: '한성대학교' },
};
/** 1인가구 물품대여소(장위로 82). 장위1동 주민센터 부근(OpenStreetMap) 기준 대략값. */
export const CENTER_SPOT: HubSpot = {
  lat: 37.6141,
  lng: 127.0437,
  mapQuery: '서울 성북구 장위로 82',
};

/** 두 지점 사이 직선거리(m), haversine. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

/** 걸어서 걸리는 시간(분). 직선거리에 골목 보정 1.3배, 분당 67m. */
export function walkMinutes(m: number) {
  return Math.max(1, Math.round((m * 1.3) / 67));
}

export const mapUrl = (spot: HubSpot) =>
  `https://map.kakao.com/?q=${encodeURIComponent(spot.mapQuery)}`;

// ---- 현재 위치(앱 전체에서 한 번만 묻고 같이 쓴다) ----

export type Here =
  | { status: 'idle' | 'locating' }
  | { status: 'ready'; lat: number; lng: number }
  | { status: 'failed'; reason: string };

let here: Here = { status: 'idle' };
const listeners = new Set<() => void>();
const setHere = (next: Here) => {
  here = next;
  listeners.forEach((l) => l());
};

export function locate() {
  if (here.status === 'locating') return;
  if (!navigator.geolocation) {
    setHere({ status: 'failed', reason: '이 브라우저는 위치를 지원하지 않아요.' });
    return;
  }
  setHere({ status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (p) => setHere({ status: 'ready', lat: p.coords.latitude, lng: p.coords.longitude }),
    (e) =>
      setHere({
        status: 'failed',
        reason:
          e.code === e.PERMISSION_DENIED
            ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 허용하면 거리를 알려 드려요.'
            : '지금 위치를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.',
      }),
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
  );
}

/** 현재 위치. 이미 위치를 허용한 사용자는 바로 찾고, 처음이면 locate()를 부를 때만 묻는다. */
export function useHere(): Here {
  useEffect(() => {
    if (here.status !== 'idle') return;
    void navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((s) => s.state === 'granted' && locate())
      .catch(() => {});
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => here,
  );
}

/** 장소까지 거리(m). 위치를 모르거나 좌표가 없는 장소면 null. */
export function metersTo(h: Here, placeId: string): number | null {
  const spot = HUB_SPOTS[placeId];
  return h.status === 'ready' && spot ? distanceMeters(h, spot) : null;
}

// ---- 성북구 경계 ----
/** 점이 성북구 안인지(경계 다각형, ray casting). */
export function insideSeongbuk(p: { lat: number; lng: number }) {
  let inside = false;
  const ring = SEONGBUK_BOUNDARY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
