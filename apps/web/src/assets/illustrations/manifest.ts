import type { AssetMetadata } from '@sb/contracts';
import sharing_home from './sharing-home.svg';
import cleaning from './cleaning.svg';
import tools from './tools.svg';
import travel from './travel.svg';
import hobby from './hobby.svg';
import empty from './empty.svg';
import waiting from './waiting.svg';
import comparison from './comparison.svg';
import center_garden from './center-garden.svg';
import center_space from './center-space.svg';

export const illustrationManifest = [
  {
    id: 'sharing-home',
    src: sharing_home,
    width: 600,
    height: 340,
    alt: '서로 물품을 나누는 이웃과 사다리, 프로젝터, 캐리어',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 387,
  },
  {
    id: 'cleaning',
    src: cleaning,
    width: 240,
    height: 180,
    alt: '청소기와 작은 청소솔 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 427,
  },
  {
    id: 'tools',
    src: tools,
    width: 240,
    height: 180,
    alt: '망치와 드라이버 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 367,
  },
  {
    id: 'travel',
    src: travel,
    width: 240,
    height: 180,
    alt: '여행용 캐리어와 작은 가방 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 446,
  },
  {
    id: 'hobby',
    src: hobby,
    width: 240,
    height: 180,
    alt: '프로젝터와 화분 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 383,
  },
  {
    id: 'empty',
    src: empty,
    width: 240,
    height: 180,
    alt: '열린 봉투 곁에 놓인 작은 잎',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 332,
  },
  {
    id: 'waiting',
    src: waiting,
    width: 240,
    height: 180,
    alt: '응답 카드를 기다리는 작은 모래시계',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 358,
  },
  {
    id: 'comparison',
    src: comparison,
    width: 240,
    height: 180,
    alt: '나란히 도착한 두 장의 제안 카드',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 333,
  },
  {
    id: 'center-garden',
    src: center_garden,
    width: 600,
    height: 340,
    alt: '함께 모여 차를 마시는 정원 모임의 합성 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 384,
  },
  {
    id: 'center-space',
    src: center_space,
    width: 600,
    height: 340,
    alt: '책상과 의자, 창가 식물이 있는 합성 공간 일러스트',
    decorative: true,
    license: 'CC0-1.0',
    creator: '성북 공유대여 · 자체 SVG 제작',
    format: 'svg',
    byteSize: 361,
  },
] as const satisfies readonly AssetMetadata[];

export type IllustrationId = (typeof illustrationManifest)[number]['id'];
export const illustrations = Object.fromEntries(
  illustrationManifest.map((asset) => [asset.id, asset]),
) as Record<IllustrationId, (typeof illustrationManifest)[number]>;
export const categoryIllustrations = {
  CLEANING: illustrations.cleaning,
  TOOLS: illustrations.tools,
  TRAVEL: illustrations.travel,
  HOBBY: illustrations.hobby,
} as const;
