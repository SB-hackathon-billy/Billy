import type { CharacterRendererProps } from './character.js';

/**
 * Placeholder 2D character (임의 캐릭터). All motion is CSS keyed on data-state, so a 3D renderer can
 * replace this component without touching the call screen. Decorative: the state is announced as text.
 */
export function Character2D({ state, progress, reducedMotion }: CharacterRendererProps) {
  const fill = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      className="vc-character"
      data-state={state}
      data-reduced-motion={reducedMotion || undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 200" width="200" height="200" focusable="false">
        <defs>
          <radialGradient id="vc-body" cx="38%" cy="30%" r="75%">
            <stop offset="0" stopColor="#c9e4cf" />
            <stop offset="0.6" stopColor="#8fbf9d" />
            <stop offset="1" stopColor="#5f9474" />
          </radialGradient>
          <clipPath id="vc-belly">
            <ellipse cx="100" cy="132" rx="34" ry="24" />
          </clipPath>
        </defs>
        <ellipse className="vc-shadow" cx="100" cy="186" rx="52" ry="8" />
        <g className="vc-ring">
          <circle cx="100" cy="104" r="90" />
        </g>
        <g className="vc-body">
          <path className="vc-ear vc-ear-left" d="M58 58 C44 30 50 14 66 22 C76 28 78 44 76 56 Z" />
          <path
            className="vc-ear vc-ear-right"
            d="M142 58 C156 30 150 14 134 22 C124 28 122 44 124 56 Z"
          />
          <path
            className="vc-blob"
            d="M100 36 C146 36 172 70 170 116 C168 156 140 178 100 178 C60 178 32 156 30 116 C28 70 54 36 100 36 Z"
          />
          <ellipse className="vc-belly-bg" cx="100" cy="132" rx="34" ry="24" />
          <rect
            className="vc-belly-fill"
            x="66"
            y={156 - (48 * fill) / 100}
            width="68"
            height="48"
            clipPath="url(#vc-belly)"
          />
          <g className="vc-face">
            <g className="vc-eyes">
              <ellipse className="vc-eye" cx="78" cy="96" rx="7" ry="9" />
              <ellipse className="vc-eye" cx="122" cy="96" rx="7" ry="9" />
              <path className="vc-happy-eye" d="M70 98 q8 -10 16 0 M114 98 q8 -10 16 0" />
            </g>
            <ellipse className="vc-cheek" cx="64" cy="112" rx="8" ry="5" />
            <ellipse className="vc-cheek" cx="136" cy="112" rx="8" ry="5" />
            <path className="vc-mouth" d="M88 114 q12 10 24 0" />
            <ellipse className="vc-mouth-open" cx="100" cy="117" rx="9" ry="6" />
          </g>
        </g>
        <g className="vc-thought">
          <circle cx="150" cy="44" r="5" />
          <circle cx="164" cy="44" r="5" />
          <circle cx="178" cy="44" r="5" />
        </g>
        <g className="vc-sparkles">
          <path d="M36 50 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z" />
          <path d="M166 74 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" />
        </g>
        <g className="vc-clipboard">
          <rect x="140" y="118" width="34" height="42" rx="5" />
          <path d="M147 132 h20 M147 141 h20 M147 150 h12" />
        </g>
      </svg>
    </div>
  );
}
