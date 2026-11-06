import type { ReactNode } from 'react';
import type { Artwork } from './posts.js';

const palette: Record<Artwork, [string, string]> = {
  rental: ['#e6fac8', '#43682c'],
  counsel: ['#ffe7dc', '#a14d2f'],
  kitchen: ['#fff7e9', '#74613c'],
  dining: ['#e0f0e5', '#2b5b44'],
  share: ['#e3ecef', '#3f5f6b'],
  club: ['#f0f8f2', '#407358'],
  laptop: ['#e9ece5', '#173c2c'],
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

/** Decorative illustration standing in for the post's original photo. */
export function PostArtwork({ artwork, label }: { artwork: Artwork; label?: string }) {
  const [background, ink] = palette[artwork];
  return (
    <svg
      className="cb-artwork"
      viewBox="0 0 200 140"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect width="200" height="140" fill={background} />
      <circle cx="170" cy="20" r="34" fill="#FFFFFF" opacity="0.45" />
      <g fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        {shapes[artwork]}
      </g>
    </svg>
  );
}
