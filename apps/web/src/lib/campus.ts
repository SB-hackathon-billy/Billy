// 캠퍼스 거점 위치와 거리 계산. 위치는 브라우저 안에서만 쓰고 서버로 보내지 않는다.
// 거점 좌표: OpenStreetMap(Nominatim) 학교 위치(2026-11-06 확인). 거점이 데이터로 늘면 Place에 좌표를 둔다.

import { useEffect, useSyncExternalStore } from 'react';

export interface HubSpot {
  lat: number;
  lng: number;
  /** 지도 검색어. */
  mapQuery: string;
}

export const HUB_SPOTS: Record<string, HubSpot> = {
  'place-korea': { lat: 37.588, lng: 127.0324, mapQuery: '고려대학교 서울캠퍼스' },
  'place-kookmin': { lat: 37.6115, lng: 126.9964, mapQuery: '국민대학교' },
  'place-dongduk': { lat: 37.6065, lng: 127.0419, mapQuery: '동덕여자대학교' },
  'place-seokyeong': { lat: 37.6149, lng: 127.0129, mapQuery: '서경대학교' },
  'place-sungshin': { lat: 37.5914, lng: 127.0222, mapQuery: '성신여자대학교' },
  'place-hansung': { lat: 37.5821, lng: 127.0105, mapQuery: '한성대학교' },
};
/** 1인가구 물품대여소(장위로 82). 도로 위치 기준 대략값. */
export const CENTER_SPOT: HubSpot = {
  lat: 37.615,
  lng: 127.041,
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

// ---- 성북구 지도: 실제 행정경계(통계청 2013 구 경계, southkorea/seoul-maps)를 단순화한 SVG 경로 ----
/** 같은 투영(등장방형, 위도 보정)으로 거점·내 위치를 찍는다. */
export const SEONGBUK_MAP = {
  width: 432,
  height: 340.5,
  path: 'M16.0 43.0 L22.1 37.7 L25.2 32.0 L32.4 30.1 L39.7 25.4 L42.8 25.6 L45.8 20.5 L51.3 16.6 L53.4 17.4 L55.5 16.0 L59.6 21.9 L61.4 23.2 L64.6 23.5 L68.6 28.4 L79.7 36.4 L83.0 39.8 L86.8 37.6 L89.8 37.8 L94.7 50.7 L96.6 51.2 L98.1 50.4 L104.9 55.1 L119.1 72.4 L128.9 73.3 L137.6 79.3 L145.8 79.8 L151.9 81.8 L151.5 85.2 L149.7 89.8 L149.6 93.9 L150.2 94.0 L149.4 95.0 L151.1 98.6 L152.4 105.8 L153.8 107.4 L154.3 110.2 L159.8 113.8 L160.8 118.2 L163.5 121.1 L166.6 121.2 L173.2 125.0 L180.2 125.5 L181.4 127.7 L181.3 129.6 L184.8 129.7 L186.2 128.7 L192.1 130.9 L194.5 133.9 L198.8 135.1 L203.9 141.4 L210.3 142.8 L211.1 148.1 L219.8 143.9 L223.1 144.2 L226.8 143.1 L228.4 140.8 L244.1 142.6 L244.1 155.8 L245.0 159.2 L273.4 139.9 L284.1 125.3 L281.3 123.6 L281.0 121.8 L285.5 123.7 L301.0 109.4 L304.3 104.7 L310.5 91.7 L326.0 79.4 L343.4 101.6 L352.5 109.3 L355.8 114.1 L359.7 117.7 L370.3 124.7 L369.3 126.0 L371.2 127.3 L371.2 128.9 L375.7 131.9 L385.2 132.1 L388.7 133.1 L392.0 132.4 L392.3 133.2 L393.1 131.2 L399.5 127.5 L400.5 125.7 L409.3 123.7 L413.7 121.5 L414.8 127.7 L415.9 171.4 L411.0 170.9 L410.7 158.2 L402.9 158.3 L403.5 171.1 L400.9 171.4 L400.9 173.0 L397.9 173.1 L397.5 174.3 L393.2 176.6 L393.1 177.9 L389.8 178.2 L388.0 176.3 L382.7 179.4 L377.1 179.4 L373.6 184.0 L373.2 185.8 L372.3 185.6 L371.8 187.8 L367.9 191.0 L367.2 195.0 L369.7 197.1 L364.3 200.2 L363.9 201.6 L356.4 200.8 L356.5 199.0 L348.5 201.6 L347.0 200.0 L343.7 203.5 L338.9 204.3 L337.1 206.3 L334.4 207.2 L331.5 198.5 L330.1 198.8 L327.2 201.2 L327.1 203.1 L322.0 213.2 L321.7 216.3 L318.4 219.7 L316.3 226.4 L313.5 227.4 L309.9 224.4 L301.3 226.3 L298.1 221.5 L293.7 225.5 L292.8 223.0 L289.0 233.2 L287.7 232.8 L287.8 228.9 L280.8 252.6 L269.5 252.7 L269.7 259.6 L258.1 273.8 L239.6 299.0 L215.0 320.1 L215.0 321.7 L213.8 322.9 L212.3 321.4 L213.2 320.0 L209.6 317.4 L207.4 317.5 L198.6 321.6 L196.6 324.5 L194.0 323.7 L193.5 322.4 L194.8 318.9 L194.6 316.1 L193.7 314.0 L191.8 312.8 L190.3 307.5 L189.1 306.9 L188.6 303.4 L187.0 301.8 L183.2 301.8 L179.9 299.8 L172.1 304.6 L169.2 303.5 L166.2 304.3 L161.7 310.3 L155.7 309.1 L153.9 305.6 L148.3 300.6 L147.8 299.2 L149.6 294.0 L147.4 285.9 L147.5 283.7 L145.8 282.0 L146.1 279.4 L143.7 275.3 L136.9 274.4 L136.5 269.9 L133.3 267.8 L132.9 265.9 L128.8 263.6 L127.2 259.5 L125.4 258.2 L125.3 256.0 L126.2 256.1 L127.0 252.7 L125.6 249.2 L123.0 246.7 L113.1 246.1 L104.6 248.6 L101.1 247.5 L95.9 252.7 L87.6 249.1 L85.6 249.6 L83.8 252.0 L80.2 251.4 L74.5 253.0 L73.9 251.9 L75.6 249.8 L72.6 248.2 L63.2 246.1 L54.1 240.5 L44.7 228.7 L42.9 221.8 L42.9 211.5 L47.6 210.2 L56.7 209.9 L62.8 206.6 L68.4 200.6 L60.8 169.7 L61.2 161.0 L62.3 155.1 L65.2 151.7 L64.7 138.3 L65.6 136.2 L64.1 130.3 L58.5 125.8 L49.8 121.7 L48.0 119.8 L48.6 117.4 L47.8 115.7 L48.5 113.9 L44.7 109.2 L43.8 106.1 L45.0 102.9 L42.5 98.1 L42.1 93.5 L40.5 91.3 L40.0 88.1 L37.9 86.4 L37.1 84.0 L33.1 78.6 L34.3 75.2 L33.6 73.7 L33.9 71.6 L35.1 69.9 L34.1 66.2 L35.0 60.9 L38.4 57.4 L38.5 55.2 L36.8 54.1 L34.4 54.5 L29.0 58.5 L22.6 56.3 L19.4 56.2 L21.3 54.1 L21.7 52.1 L20.8 45.0 L16.0 43.0 Z',
} as const;
const PROJ = { minLng: 126.977175, maxLat: 37.633776, kx: 0.792245, k: 5222.38, pad: 16 };
export function project(p: { lat: number; lng: number }) {
  return {
    x: PROJ.pad + (p.lng - PROJ.minLng) * PROJ.kx * PROJ.k,
    y: PROJ.pad + (PROJ.maxLat - p.lat) * PROJ.k,
  };
}
