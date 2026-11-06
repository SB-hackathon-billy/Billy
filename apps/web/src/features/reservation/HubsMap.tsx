// 캠퍼스 대여소 지도: 성북구 실제 경계·행정동 경계를 색면으로 단순하게 그린 SVG.
// 학교 6곳·장위동 물품대여소·내 위치만 같은 투영(project)으로 찍는다. 위치는 서버로 보내지 않는다.
import { Link } from 'react-router-dom';
import {
  CENTER_SPOT,
  formatDistance,
  insideSeongbuk,
  type Here,
  type HubSpot,
} from '../../lib/campus.js';
import { SEONGBUK_SVG, project } from '../../lib/seongbuk-map.js';

export interface MapHub {
  id: string;
  label: string;
  spot: HubSpot;
  meters: number | null;
}

/** 이름표 방향: 가까운 학교끼리 겹치지 않게. */
const SIDE: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  'place-korea': 'down',
  'place-sungshin': 'up',
  'place-hansung': 'left',
  'place-kookmin': 'up',
  'place-seokyeong': 'up',
  'place-dongduk': 'down',
};
function labelAt(side: string, x: number, y: number) {
  if (side === 'down') return { x, y: y + 27, anchor: 'middle' as const };
  if (side === 'left') return { x: x - 17, y: y + 5, anchor: 'end' as const };
  if (side === 'right') return { x: x + 17, y: y + 5, anchor: 'start' as const };
  return { x, y: y - 17, anchor: 'middle' as const };
}

export default function HubsMap({
  hubs,
  here,
  selected,
}: {
  hubs: MapHub[];
  here: Here;
  selected?: string;
}) {
  const nearest = hubs.find((h) => h.meters !== null)?.id;
  const center = project(CENTER_SPOT);
  const me = here.status === 'ready' && insideSeongbuk(here) ? project(here) : null;
  return (
    <svg
      className="sb-map"
      viewBox={`0 0 ${SEONGBUK_SVG.width} ${SEONGBUK_SVG.height}`}
      role="img"
      aria-label="성북구 캠퍼스 대여소 지도"
    >
      <defs>
        <filter id="sb-map-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#3b3570" floodOpacity="0.14" />
        </filter>
      </defs>
      <path d={SEONGBUK_SVG.outline} className="sb-land" filter="url(#sb-map-shadow)" />
      <path d={SEONGBUK_SVG.dongs} className="sb-dongs" />
      <path d={SEONGBUK_SVG.outline} className="sb-edge" />
      <g className="sb-center">
        <rect
          x={center.x - 8}
          y={center.y - 8}
          width="16"
          height="16"
          rx="3"
          transform={`rotate(45 ${center.x} ${center.y})`}
        />
        <text x={center.x} y={center.y - 17} textAnchor="middle">
          장위동 물품대여소
        </text>
      </g>
      {hubs.map((h) => {
        const { x, y } = project(h.spot);
        const state =
          selected === h.id ? 'selected' : !selected && nearest === h.id ? 'nearest' : '';
        const l = labelAt(SIDE[h.id] ?? 'up', x, y);
        return (
          <Link
            key={h.id}
            to={`/hubs/${h.id}`}
            aria-label={`${h.label}${h.meters !== null ? ` · ${formatDistance(h.meters)}` : ''} 물품 보기`}
          >
            <g className={`sb-pin ${state}`}>
              <circle cx={x} cy={y} r="19" className="halo" />
              <circle cx={x} cy={y} r="9" className="dot" />
              <text x={l.x} y={l.y} textAnchor={l.anchor} className="name">
                {h.label.replace(' 거점', '')}
                {h.meters !== null && <tspan className="dist"> {formatDistance(h.meters)}</tspan>}
              </text>
            </g>
          </Link>
        );
      })}
      {me && (
        <g className="sb-me">
          <circle cx={me.x} cy={me.y} r="14" className="halo" />
          <circle cx={me.x} cy={me.y} r="6" />
        </g>
      )}
    </svg>
  );
}
