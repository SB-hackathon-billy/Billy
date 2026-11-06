// 캠퍼스 대여소 지도(Leaflet + OpenStreetMap 타일). 대여소 화면을 열 때만 불러온다(lazy).
// 성북구 경계(OpenStreetMap)를 강조하고 바깥은 흐리게, 학교 6곳·장위동 물품대여소·내 위치만 표시한다.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CENTER_SPOT, formatDistance, type Here, type HubSpot } from '../../lib/campus.js';
import { SEONGBUK_BOUNDARY } from '../../lib/seongbuk-boundary.js';

export interface MapHub {
  id: string;
  label: string;
  spot: HubSpot;
  meters: number | null;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const WORLD: L.LatLngExpression[] = [
  [85, -180],
  [85, 180],
  [-85, 180],
  [-85, -180],
];
const BOUNDARY = SEONGBUK_BOUNDARY as unknown as L.LatLngExpression[];

export default function HubsMap({
  hubs,
  here,
  selected,
  onPick,
}: {
  hubs: MapHub[];
  here: Here;
  selected?: string;
  onPick: (placeId: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const m = L.map(el.current!, {
      zoomControl: true,
      scrollWheelZoom: false,
      zoomSnap: 0.25,
      attributionControl: true,
    });
    // ponytail: OpenStreetMap 기본 타일(키 없음, 사용 정책상 소량 이용). 이용이 늘면 키가 있는 타일 서비스로 바꾼다.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // 앱은 Referrer-Policy: same-origin이라 타일 요청에 출처가 빠져 OSM이 막는다. 타일만 출처(도메인)를 보낸다.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    // 성북구 밖은 흐리게, 경계선은 보라색으로.
    L.polygon([WORLD, BOUNDARY], {
      stroke: false,
      fillColor: '#1f1b3d',
      fillOpacity: 0.22,
      interactive: false,
    }).addTo(m);
    L.polygon(BOUNDARY, {
      color: '#5b4fae',
      weight: 3,
      opacity: 0.9,
      fill: true,
      fillColor: '#5b4fae',
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(m);
    m.fitBounds(L.latLngBounds(BOUNDARY), { padding: [8, 8] });
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const layer = pins.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const nearest = hubs.find((h) => h.meters !== null)?.id;
    const center = L.marker([CENTER_SPOT.lat, CENTER_SPOT.lng], {
      icon: L.divIcon({
        className: 'lp-wrap',
        html: '<div class="lp lp-center"><span class="lp-diamond"></span><span class="lp-label">장위동 물품대여소</span></div>',
        iconSize: [0, 0],
      }),
      keyboard: false,
      title: '1인가구 물품대여소(장위로 82) · 평일 9~18시',
    });
    layer.addLayer(center);
    for (const h of hubs) {
      const state = selected === h.id ? 'selected' : !selected && nearest === h.id ? 'nearest' : '';
      const name = esc(h.label.replace(' 거점', ''));
      const dist = h.meters !== null ? `<b>${formatDistance(h.meters)}</b>` : '';
      const marker = L.marker([h.spot.lat, h.spot.lng], {
        icon: L.divIcon({
          className: 'lp-wrap',
          html: `<div class="lp ${state}"><span class="lp-dot"></span><span class="lp-label">${name}${dist}</span></div>`,
          iconSize: [0, 0],
        }),
        title: `${h.label} 물품 보기`,
        riseOnHover: true,
        zIndexOffset: state ? 1000 : 0,
      });
      marker.on('click', () => pick.current(h.id));
      layer.addLayer(marker);
    }
    if (here.status === 'ready')
      layer.addLayer(
        L.marker([here.lat, here.lng], {
          icon: L.divIcon({
            className: 'lp-wrap',
            html: '<div class="lp-me"><span></span></div>',
            iconSize: [0, 0],
          }),
          keyboard: false,
          title: '내 위치',
          zIndexOffset: 2000,
        }),
      );
    const focus = hubs.find((h) => h.id === selected);
    if (focus) m.setView([focus.spot.lat, focus.spot.lng], 15, { animate: false });
  }, [hubs, here, selected]);

  return (
    <div ref={el} className="hubs-leaflet" role="region" aria-label="성북구 캠퍼스 대여소 지도" />
  );
}
