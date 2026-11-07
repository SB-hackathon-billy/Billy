import type { Artwork } from './posts.js';
import { figmaIcons } from './figma-icons.js';

/** 디자이너 센터 소식 화면의 선 아이콘: 같은 그림을 배경 없이 한 색 선으로. 색은 currentColor. */
export function PostIcon({ artwork }: { artwork: Artwork }) {
  const icon = figmaIcons[artwork];
  return (
    <svg
      className="cb-icon"
      viewBox={icon.viewBox}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** 센터 소식 화면과 같은 파란 선 아이콘을 옅은 파란 타일에 얹은 그림(원본 사진 대신). */
export function PostArtwork({ artwork, label }: { artwork: Artwork; label?: string }) {
  const icon = figmaIcons[artwork];
  return (
    <svg
      className="cb-artwork"
      viewBox="0 0 200 140"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect width="200" height="140" rx="14" fill="#EAF4FD" />
      <svg x="60" y="30" width="80" height="80" viewBox={icon.viewBox} color="#146CFC">
        <g dangerouslySetInnerHTML={{ __html: icon.body }} />
      </svg>
    </svg>
  );
}
