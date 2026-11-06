import { useId, type ReactNode } from 'react';
import type { Artwork } from './posts.js';

/** [배경 밝은 색, 배경 중간 색(그림자 선), 잉크]. */
const palette: Record<Artwork, [string, string, string]> = {
  rental: ['#f1fbe0', '#c4e98a', '#2f5a1c'],
  counsel: ['#fff2ea', '#ffc2a3', '#8f3b1f'],
  kitchen: ['#fff9ec', '#f1d493', '#6a5326'],
  dining: ['#ebf7ef', '#a6dbb9', '#1f513a'],
  share: ['#edf4f7', '#b2cfdb', '#2e4f5c'],
  club: ['#f2faf4', '#b6e2c3', '#2f6347'],
  laptop: ['#f0f3ec', '#c4cfbc', '#163828'],
};
const shapes: Record<Artwork, ReactNode> = {
  rental: (
    <>
      <rect x="58" y="44" width="52" height="64" rx="8" />
      <path d="M74 44v-8h20v8M66 108v6M102 108v6M58 70h52" />
      <rect x="120" y="70" width="44" height="38" rx="5" />
      <path d="M120 84h44M136 70v38" />
    </>
  ),
  counsel: (
    <>
      <path d="M50 48h70a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H82l-16 14v-14H50a10 10 0 0 1-10-10V58a10 10 0 0 1 10-10Z" />
      <path d="M85 86c-9-7-16-12-16-19a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 7-7 12-16 19Z" />
      <circle cx="150" cy="54" r="12" />
      <path d="M134 100a16 16 0 0 1 32 0" />
    </>
  ),
  kitchen: (
    <>
      <path d="M48 76h84v22a20 20 0 0 1-20 20H68a20 20 0 0 1-20-20Z" />
      <path d="M40 76h100M132 82h16M72 64c0-8 8-8 8-16M92 64c0-8 8-8 8-16" />
      <path d="M150 50v66M160 50v20a10 10 0 0 1-20 0V50" />
    </>
  ),
  dining: (
    <>
      <path d="M46 78h108a54 40 0 0 1-108 0Z" />
      <ellipse cx="100" cy="78" rx="54" ry="10" />
      <ellipse cx="86" cy="76" rx="9" ry="4" />
      <ellipse cx="108" cy="74" rx="9" ry="4" />
      <path d="M82 56c0-8 8-8 8-16M104 56c0-8 8-8 8-16M150 40l-26 30M160 46l-30 26" />
    </>
  ),
  share: (
    <>
      <path d="M40 102c16 0 22-12 40-12h22a8 8 0 0 1 0 16H86M40 120h40l44-16a8 8 0 0 0-6-14" />
      <path d="M98 70c-12-9-20-15-20-24a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 9-8 15-20 24Z" />
      <circle cx="150" cy="60" r="10" />
      <path d="M136 92a14 14 0 0 1 28 0" />
    </>
  ),
  club: (
    <>
      <circle cx="70" cy="58" r="12" />
      <circle cx="100" cy="50" r="12" />
      <circle cx="130" cy="58" r="12" />
      <path d="M50 104a20 20 0 0 1 40 0M80 96a20 20 0 0 1 40 0M110 104a20 20 0 0 1 40 0" />
      <path d="M44 112h112" />
    </>
  ),
  laptop: (
    <>
      <rect x="58" y="42" width="84" height="56" rx="6" />
      <path d="M44 108h112l-8 10H52Z" />
      <path d="M74 62h30M74 74h48" />
    </>
  ),
};

/** 디자이너 센터 소식 화면의 선 아이콘: 같은 그림을 배경 없이 한 색 선으로. 색은 currentColor. */
export function PostIcon({ artwork }: { artwork: Artwork }) {
  return (
    <svg
      className="cb-icon"
      viewBox="34 28 132 96"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[artwork]}
    </svg>
  );
}

/** Decorative illustration standing in for the post's original photo. */
export function PostArtwork({ artwork, label }: { artwork: Artwork; label?: string }) {
  const [light, mid, ink] = palette[artwork];
  // 같은 화면에 여러 장이 있어도 그라데이션 id가 겹치지 않게 한다.
  const uid = useId().replace(/:/g, '');
  const bg = `cb-bg-${uid}`;
  const glow = `cb-glow-${uid}`;
  const shadow = `cb-shadow-${uid}`;
  const clip = `cb-clip-${uid}`;
  return (
    <svg
      className="cb-artwork"
      viewBox="0 0 200 140"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <filter id={shadow} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor={ink} floodOpacity="0.16" />
        </filter>
        {/* 칸이 그림보다 넓어도(상세 화면) 장식이 그림 밖으로 나가지 않게 자른다. */}
        <clipPath id={clip}>
          <rect width="200" height="140" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="200" height="140" fill={`url(#${bg})`} />
        <circle cx="172" cy="14" r="64" fill={`url(#${glow})`} />
        <circle cx="16" cy="132" r="44" fill="#FFFFFF" opacity="0.28" />
        <rect
          x="32"
          y="20"
          width="136"
          height="104"
          rx="26"
          fill="#FFFFFF"
          fillOpacity="0.7"
          filter={`url(#${shadow})`}
        />
        <g transform="translate(10 7.8) scale(0.9)">
          {/* 어긋난 그림자 선으로 투톤 느낌을 낸다. */}
          <g
            fill="none"
            stroke={mid}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(3 4)"
          >
            {shapes[artwork]}
          </g>
          <g
            fill="none"
            stroke={ink}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {shapes[artwork]}
          </g>
        </g>
        <g fill="#FFFFFF">
          <path d="M158 36l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
          <circle cx="44" cy="112" r="2.5" opacity="0.9" />
          <circle cx="176" cy="104" r="3" opacity="0.7" />
        </g>
      </g>
    </svg>
  );
}
