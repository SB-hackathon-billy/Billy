// 센터 서비스 시연 데이터. 명세: docs/specs/0003-voice-call-reservation.md 9절
// 공식 사이트(sb1in.or.kr)에 올라온 공지·소식을 공개 보도·구청 공지에서 확인한 내용만 옮겼다.
// 날짜·숫자는 출처에 있는 값만 쓰고, 확인되지 않은 세부 사항은 "원문 확인"으로 남긴다.
// 원본 사진은 이 환경에서 내려받지 못해 글마다 맞춘 자체 일러스트(artwork)를 쓴다.

export type BoardKind = 'NOTICE' | 'RECRUIT' | 'NEWS';
export type Artwork = 'rental' | 'counsel' | 'kitchen' | 'dining' | 'share' | 'club' | 'laptop';

export interface CenterPost {
  id: string;
  board: BoardKind;
  title: string;
  /** Published/event date from the source (YYYY-MM-DD), or null when the source gives none. */
  date: string | null;
  summary: string;
  body: string[];
  facts: [label: string, value: string][];
  artwork: Artwork;
  source: { label: string; url: string };
  /** In-app action that replaces the old site's flow, if any. */
  action?: { label: string; to: string };
  pinned?: boolean;
}

export const BOARD_LABELS: Record<BoardKind, string> = {
  NOTICE: '공지사항',
  RECRUIT: '모집',
  NEWS: '센터 소식',
};

export const CENTER_PROFILE = Object.freeze({
  name: '성북구 1인가구지원센터',
  operator: '성북복지재단',
  address: '서울특별시 성북구 장위로8길 20',
  hours: '평일 09:00–18:00 (점심 12:00–13:00)',
  phone: '070-4271-5490',
  site: 'https://sb1in.or.kr/',
});

export const centerPosts: CenterPost[] = [
  {
    id: 'rental-guide',
    board: 'NOTICE',
    pinned: true,
    title: '1인가구 물품대여소 이용 안내',
    date: null,
    summary:
      '캐리어·카메라·미니빔·캠핑용품 등 자주 쓰지 않는 생활용품을 센터 1층에서 빌려 쓸 수 있어요.',
    body: [
      '성북구에 주민등록이 된 1인가구라면 누구나 물품대여 서비스를 이용할 수 있습니다. 대여 장소는 성북구 1인가구지원센터 1층입니다.',
      '대여 기간은 1회 7일이며, 예약자가 없으면 한 번 연장해 최대 14일까지 빌릴 수 있습니다. 1회 대여 시 물품별 1개, 최대 2개까지 신청할 수 있습니다.',
      '리디자인한 앱에서는 상담 도우미와 통화하며 필요한 정보를 하나씩 채우고, 정리된 신청 내용을 확인한 뒤 바로 예약 신청할 수 있습니다.',
    ],
    facts: [
      ['대상', '성북구 주민등록 1인가구'],
      ['장소', '성북구 1인가구지원센터 1층 (장위로8길 20)'],
      ['이용 시간', '평일 09:30–17:30'],
      ['기간', '1회 7일 · 예약자가 없으면 1회 연장(최대 14일)'],
      ['수량', '물품별 1개, 최대 2개'],
      ['주요 품목', '캐리어, 카메라, 미니빔, 마사지기기, 가습기, 에어랩, 전기히터, 캠핑용품 등'],
      ['문의', '070-4271-5490'],
    ],
    artwork: 'rental',
    source: { label: '청년개발자신문 보도', url: 'https://www.devtimes.co.kr/news/424966' },
    action: { label: '상담 통화로 대여 신청하기', to: '/rental' },
  },
  {
    id: 'mind-check-2026',
    board: 'RECRUIT',
    pinned: true,
    title: '[상시 모집] 마음점검 — 성격검사 기반 심리지원 프로그램',
    date: null,
    summary: '전문 상담기관과 함께하는 2회기 성격검사 프로그램을 연중 선착순으로 모집합니다.',
    body: [
      '성북구 1인가구지원센터가 전문 상담기관과 연계해 성격검사를 활용한 2회기 심리지원 프로그램 "마음점검"을 운영합니다.',
      '연중 상시, 선착순으로 모집하며 서울시에 거주하는 1인가구가 대상입니다. 성북구 거주자를 우선 선정합니다.',
      '신청은 온라인 신청서로 받습니다. 당일 취소나 무단 불참 시 이후 센터 프로그램 참여가 제한될 수 있습니다.',
    ],
    facts: [
      ['구성', '성격검사 기반 상담 2회기'],
      ['모집', '연중 상시 · 선착순'],
      ['대상', '서울시 1인가구 (성북구 거주자 우선)'],
      ['신청', '온라인 신청서'],
      ['유의', '당일 취소·무단 불참 시 참여 제한'],
    ],
    artwork: 'counsel',
    source: {
      label: '성북구청 새소식',
      url: 'https://www.sb.go.kr/www/selectBbsNttView.do?key=6350&bbsNo=41&nttNo=9583016&pageIndex=1',
    },
    action: { label: '신청 화면 보기', to: '/center/services/mind-check' },
  },
  {
    id: 'senior-meal-2026',
    board: 'NEWS',
    title: '받는 손에서 건네는 손으로… 1인가구가 차린 어르신 보양식',
    date: '2026-07-30',
    summary: '1인가구 주민들이 직접 조리·포장한 보양식 30인분을 정릉1동 경로당 어르신께 전했어요.',
    body: [
      '센터를 이용하는 1인가구 주민들이 직접 조리와 포장에 참여해 정릉1동 경로당 어르신 30인분의 보양식을 마련했습니다.',
      '도움을 받던 1인가구가 이웃에게 먼저 손을 건네는 나눔 활동입니다.',
    ],
    facts: [
      ['활동', '보양식 조리·포장·전달'],
      ['대상', '정릉1동 경로당 어르신 30인분'],
      ['참여', '성북구 1인가구 주민'],
    ],
    artwork: 'share',
    source: {
      label: '서울신문 보도',
      url: 'https://m.go.seoul.co.kr/news/2026/07/30/20260730020005',
    },
  },
  {
    id: 'tteokguk-day-2026',
    board: 'NEWS',
    title: '설 앞두고 이웃과 함께 — "복(福) 떡국 데이"',
    date: '2026-01-27',
    summary: '설을 앞둔 1월 27일, 성북곳간에서 1인가구 소셜다이닝 "복 떡국 데이"가 열렸어요.',
    body: [
      '설 명절을 앞둔 1월 27일, 공유주방 성북곳간에서 1인가구를 대상으로 한 소셜다이닝 행사 "복(福) 떡국 데이"를 진행했습니다.',
      '1인가구 이웃이 함께 떡국을 나누는 자리였습니다.',
    ],
    facts: [
      ['일시', '2026년 1월 27일'],
      ['장소', '성북곳간 (1인가구 공유주방)'],
      ['형식', '소셜다이닝'],
    ],
    artwork: 'dining',
    source: {
      label: '트위그뉴스 보도',
      url: 'https://www.twig24.com/news/2026/01/29/20260129500074',
    },
  },
  {
    id: 'seongbuk-gotgan-open',
    board: 'NEWS',
    title: '1인가구 공유주방 "성북곳간" 문을 열었습니다',
    date: '2025-08-12',
    summary: '1인가구 누구나 함께 요리하고 식사하며 일상을 나누는 공유주방이 생겼어요.',
    body: [
      '성북구 1인가구를 위한 공유주방 "성북곳간"이 문을 열었습니다.',
      '1인가구 누구나 함께 요리하고 식사하며 일상을 나눌 수 있는 공간으로, 소셜다이닝과 나눔 활동이 이곳에서 열립니다.',
    ],
    facts: [
      ['공간', '1인가구 공유주방'],
      ['운영', '성북복지재단 · 성북구 1인가구지원센터'],
    ],
    artwork: 'kitchen',
    source: {
      label: '헤럴드경제 보도',
      url: 'https://www.heraldk.com/article/2025081214254599546',
    },
    action: { label: '공유주방 이용 화면 보기', to: '/center/services/gotgan' },
  },
  {
    id: 'rental-review-2024',
    board: 'NEWS',
    title: '1인가구 물품 대여 서비스, 주민 호평',
    date: '2024-02-08',
    summary: '사기엔 아깝고 가끔 필요한 물건을 빌려 쓰는 물품 대여 서비스가 좋은 반응을 얻었어요.',
    body: [
      '성북구의 1인가구 물품 대여 서비스가 주민들의 호평을 받고 있다는 소식입니다.',
      '자세한 이용 현황은 원문 기사에서 확인할 수 있습니다.',
    ],
    facts: [['관련 서비스', '1인가구 물품대여']],
    artwork: 'rental',
    source: {
      label: '서울신문 보도',
      url: 'https://go.seoul.co.kr/news/newsView.php?id=20240208010006',
    },
    action: { label: '상담 통화로 대여 신청하기', to: '/rental' },
  },
  {
    id: 'club-2024',
    board: 'RECRUIT',
    title: '2024 성북구 1인가구 동아리 활동 참여자 모집',
    date: null,
    summary: '취미가 같은 1인가구 3~6명이 팀을 꾸리면 동아리 활동을 지원해요.',
    body: [
      '같은 관심사를 가진 1인가구가 3~6명 팀을 이루어 신청하면 동아리 활동을 지원합니다. 약 20개 팀을 선정합니다.',
      '문의는 성북구청 복지정책과 1인가구지원팀으로 할 수 있습니다. (지난 2023년에는 1인당 활동별 최대 3만 원의 실비를 지원했습니다.)',
    ],
    facts: [
      ['구성', '1인가구 3~6명 한 팀'],
      ['선정', '약 20팀'],
      ['문의', '복지정책과 1인가구지원팀 02-2241-2284'],
    ],
    artwork: 'club',
    source: {
      label: '성북구청 새소식',
      url: 'https://www.sb.go.kr/www/selectBbsNttView.do?key=6350&bbsNo=41&nttNo=9501733',
    },
    action: { label: '동아리 신청 화면 보기', to: '/center/services/club' },
  },
  {
    id: 'laptop-2023',
    board: 'NEWS',
    title: '1인가구에 노트북도 빌려드립니다',
    date: '2023-06-18',
    summary: '물품대여 품목에 노트북이 더해졌다는 소식이에요.',
    body: [
      '성북구가 1인가구 물품대여 품목에 노트북을 더했다는 보도입니다.',
      '현재 대여 가능 여부와 세부 조건은 원문과 센터 안내에서 확인해 주세요.',
    ],
    facts: [['관련 서비스', '1인가구 물품대여']],
    artwork: 'laptop',
    source: { label: '한국경제 보도', url: 'https://www.hankyung.com/article/202306187042i' },
  },
];

export interface CenterService {
  id: string;
  title: string;
  summary: string;
  /** How it works on the existing center service today. */
  current: string[];
  artwork: Artwork;
  /** Connected to this app; every other service is a non-integrated demo screen. */
  connectedTo?: string;
  demoFields?: string[];
}

export const centerServices: CenterService[] = [
  {
    id: 'rental',
    title: '물품대여',
    summary: '센터 1층 대여소의 생활용품을 빌려요. 상담 도우미와 통화로 신청해요.',
    current: [
      '성북구 주민등록 1인가구 대상, 1회 7일(1회 연장 가능), 물품별 1개·최대 2개.',
      '평일 09:30–17:30 센터 1층에서 수령·반납합니다.',
    ],
    artwork: 'rental',
    connectedTo: '/rental',
  },
  {
    id: 'mind-check',
    title: '마음점검 상담',
    summary: '성격검사 기반 2회기 심리지원 프로그램을 신청해요.',
    current: [
      '연중 상시·선착순 모집, 온라인 신청서로 접수합니다.',
      '성북구 거주자를 우선 선정합니다.',
    ],
    artwork: 'counsel',
    demoFields: ['이름', '연락처', '희망 요일·시간', '상담에서 나누고 싶은 이야기'],
  },
  {
    id: 'gotgan',
    title: '성북곳간 공유주방',
    summary: '함께 요리하고 식사하는 공유주방과 소셜다이닝 일정을 확인해요.',
    current: [
      '소셜다이닝·나눔 활동이 공유주방에서 열립니다.',
      '일정과 이용 방법은 센터 공지로 안내합니다.',
    ],
    artwork: 'kitchen',
    demoFields: ['이용 희망일', '인원', '이용 목적'],
  },
  {
    id: 'club',
    title: '1인가구 동아리 지원',
    summary: '관심사가 같은 3~6명이 팀을 꾸려 활동을 지원받아요.',
    current: [
      '3~6명 한 팀으로 신청, 약 20팀을 선정합니다.',
      '문의: 복지정책과 1인가구지원팀 02-2241-2284',
    ],
    artwork: 'club',
    demoFields: ['동아리 이름', '활동 주제', '팀원 수', '대표자 연락처'],
  },
  {
    id: 'membership',
    title: '회원가입·정회원 인증',
    summary: '센터 회원으로 가입하고 1인가구 정회원 자격을 확인해요.',
    current: [
      '일반회원과 정회원의 이용 범위가 다르며 일부 활동은 자격 확인이 필요합니다.',
      '회원가입·인증은 기존 센터 사이트에서 진행합니다.',
    ],
    artwork: 'share',
    demoFields: ['이름', '생년월일', '거주 동', '1인가구 확인 서류'],
  },
];

export const findPost = (id: string) => centerPosts.find((post) => post.id === id);
export const findService = (id: string) => centerServices.find((service) => service.id === id);
export function formatPostDate(date: string | null, board?: BoardKind) {
  if (!date) return board === 'RECRUIT' ? '모집 공고' : '상시 안내';
  const [y, m, d] = date.split('-');
  return `${y}. ${Number(m)}. ${Number(d)}.`;
}
export function sortedPosts(board: BoardKind | 'ALL' = 'ALL') {
  return centerPosts
    .filter((post) => board === 'ALL' || post.board === board)
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        (b.date ?? '0000').localeCompare(a.date ?? '0000'),
    );
}
