// 센터 소식 화면(Figma "11 센터 공지/소식")에 쓴 Iconify 아이콘 원본. 색은 currentColor.
// 라이선스: bi·andrsrxn·hugeicons = MIT, ic·icon-park-twotone = Apache-2.0, fa7-solid(Font Awesome) = CC BY 4.0.
import type { Artwork } from './posts.js';

export const figmaIcons: Record<Artwork, { source: string; viewBox: string; body: string }> = {
  rental: {
    source: 'bi:luggage',
    viewBox: '0 0 16 16',
    body: `<g fill="currentColor"><path d="M2.5 1a.5.5 0 0 0-.5.5V5h-.5A1.5 1.5 0 0 0 0 6.5v7a1.5 1.5 0 0 0 1 1.415v.335a.75.75 0 0 0 1.5 0V15H4v-1H1.5a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V7h1v-.5A1.5 1.5 0 0 0 6.5 5H6V1.5a.5.5 0 0 0-.5-.5zM5 5H3V2h2z"/><path d="M3 7.5a.5.5 0 0 0-1 0v5a.5.5 0 0 0 1 0zM11 6a1.5 1.5 0 0 1 1.5 1.5V8h2A1.5 1.5 0 0 1 16 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 5 14.5v-5A1.5 1.5 0 0 1 6.5 8h2v-.5A1.5 1.5 0 0 1 10 6zM9.5 7.5V8h2v-.5A.5.5 0 0 0 11 7h-1a.5.5 0 0 0-.5.5M6 9.5v5a.5.5 0 0 0 .5.5H7V9h-.5a.5.5 0 0 0-.5.5m7 5.5V9H8v6zm1.5 0a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5H14v6z"/></g>`,
  },
  counsel: {
    source: 'andrsrxn:user-heart',
    viewBox: '0 0 24 24',
    body: `<g fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.59 15.7c-.94 0-1.61.7-1.83 1.05a2.3 2.3 0 0 0-1.83-1.05c-1.17 0-2.05 1.33-1.67 2.74c.37 1.4 2.6 2.55 3.5 3.56c.88-1 3.12-2.15 3.5-3.56s-.5-2.74-1.67-2.74"/><path fill="currentColor" d="M15.47 7.99a5.4 5.4 0 1 1-10.79 0a5.4 5.4 0 0 1 10.8 0" opacity=".2"/><path fill="currentColor" d="M18.38 21.84H1.78a8.4 8.4 0 0 1 8.3-8.46c2.36 0 4.49 1 6 2.62c-1.82 2.88.2 3.93 2.3 5.84" opacity=".2"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.47 7.87a5.4 5.4 0 0 1-5.4 5.4a5.4 5.4 0 1 1 5.4-5.4"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M1.78 21.56a8.3 8.3 0 0 1 11.28-7.74"/></g>`,
  },
  share: {
    source: 'andrsrxn:hand-receiving-heart',
    viewBox: '0 0 24 24',
    body: `<g fill="none"><path fill="currentColor" d="M18.25 1.84c-1.4 0-2.4 1.05-2.72 1.57a3.5 3.5 0 0 0-2.73-1.57c-1.74 0-3.05 1.99-2.48 4.08c.56 2.1 3.88 3.8 5.2 5.3c1.33-1.5 4.65-3.2 5.22-5.3s-.75-4.08-2.49-4.08" opacity=".2"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.25 1.84c-1.4 0-2.4 1.05-2.72 1.57a3.5 3.5 0 0 0-2.73-1.57c-1.74 0-3.05 1.99-2.48 4.08c.56 2.1 3.88 3.8 5.2 5.3c1.33-1.5 4.65-3.2 5.22-5.3s-.75-4.08-2.49-4.08"/><rect width="4.01" height="7.91" x="2.19" y="13.68" fill="currentColor" opacity=".2" rx="1"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6.2 20.26s1.16.91 2.8 1.29c3.3.75 5 .54 7.92-.46c2.13-.73 3.81-2.69 4.66-3.86c.4-.54.4-1.27.05-1.85a1.98 1.98 0 0 0-2.96-.44a27 27 0 0 1-3.72 2.7c-.77.44-2.39.35-3.92.35m3.92-.35c.64-1.57.45-2.82-.24-3.07a11 11 0 0 0-4.03-.62c-3.73 0-4.48.87-4.48.87"/><rect width="4.01" height="7.91" x="2.19" y="13.68" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" rx="1"/></g>`,
  },
  dining: {
    source: 'icon-park-twotone:noodles',
    viewBox: '0 0 48 48',
    body: `<defs><mask id="SVGU0JlVdWH"><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path fill="#555" fill-rule="evenodd" d="M4 24c0 11.046 6.667 20 20 20s20-8.954 20-20z" clip-rule="evenodd"/><path d="M16 24V8m8 16V6m8 18V4M8 24V10m-4 3l40-9"/></g></mask></defs><path fill="currentColor" d="M0 0h48v48H0z" mask="url(#SVGU0JlVdWH)"/>`,
  },
  kitchen: {
    source: 'ic:round-soup-kitchen',
    viewBox: '0 0 24 24',
    body: `<path fill="currentColor" d="M6.15 13.5c-.46 0-.8-.42-.71-.87q.06-.27.06-.63c0-1-1-2.85-1-3.62c0-.29.03-.59.17-.93A.72.72 0 0 1 5.34 7c.45 0 .8.42.71.86c-.04.18-.05.35-.05.52C6 9.15 7 11 7 12c0 .42-.08.76-.17 1.01c-.1.3-.37.49-.68.49m6.5 0c.31 0 .58-.19.68-.49c.09-.25.17-.59.17-1.01c0-1-1-2.85-1-3.62c0-.17.01-.34.04-.51a.723.723 0 0 0-.7-.87a.73.73 0 0 0-.67.45c-.14.34-.17.63-.17.93c0 .77 1 2.62 1 3.62q0 .36-.06.63c-.09.45.25.87.71.87m-3.25 0c.31 0 .58-.19.68-.49c.09-.25.17-.59.17-1.01c0-1-1-2.85-1-3.62c0-.17.01-.34.04-.51a.723.723 0 0 0-.7-.87c-.3 0-.56.18-.67.45c-.14.34-.17.63-.17.93c0 .77 1 2.63 1 3.62q0 .36-.06.63c-.09.45.25.87.71.87m11.06-7.13a.99.99 0 0 0 1.12-.91c.01-.18.02-.34.02-.46c0-1.65-1.35-3-3-3c-1.54 0-2.81 1.16-2.98 2.65L14.53 15H3.99c-.6 0-1.07.54-.98 1.14C3.54 19.46 6.39 22 9.75 22c3.48 0 6.34-2.73 6.71-6.23L17.61 4.9c.05-.51.47-.9.99-.9c.55 0 1 .45 1 1c0 .07-.01.18-.01.31c-.04.53.34.99.87 1.06"/>`,
  },
  club: {
    source: 'fa7-solid:people-pulling',
    viewBox: '0 0 640 640',
    body: `<path fill="currentColor" d="M112 160c26.5 0 48-21.5 48-48s-21.5-48-48-48s-48 21.5-48 48s21.5 48 48 48m-16 32c-35.3 0-64 28.7-64 64v128c0 17.7 14.3 32 32 32c9.8 0 18.5-4.4 24.4-11.2l24 144.5c2.9 17.4 19.4 29.2 36.8 26.3s29.2-19.4 26.3-36.8L155 416.1h15.7l30 134.9c3.8 17.3 20.9 28.1 38.2 24.3s28.1-20.9 24.3-38.2l-57.3-258l116.3 53.8c.5.3 1.1.5 1.6.7c8.6 3.6 18 3.1 25.9-.7c3.4-1.6 6.6-3.9 9.3-6.7c3.1-3.2 5.5-7 7.1-11.4c.1-.3.2-.7.3-1l2.5-7.5c5.7-17.1 18.3-30.9 34.7-38.2l8-3.5c1-.4 1.9-.8 2.9-1.2l-16.9 63.5c-5.6 21.1-.1 43.6 14.7 59.7l70.7 77.1l22 88.1c4.3 17.1 21.7 27.6 38.8 23.3s27.6-21.7 23.3-38.8l-23-92.1c-1.9-7.8-5.8-14.9-11.2-20.8l-49.5-54l19.3-65.5l9.6 23c4.4 10.6 12.5 19.3 22.8 24.5l26.7 13.3c15.8 7.9 35 1.5 42.9-14.3s1.5-35-14.3-42.9L569 296.8L553.7 260c-17.1-41.1-57.3-67.9-101.9-67.9c-22.8 0-45.3 4.8-66.1 14l-8 3.5a128.9 128.9 0 0 0-58.1 51.6l-130.3-60.3c-12.6-5.9-26.4-8.9-40.3-8.9zm400-32c26.5 0 48-21.5 48-48s-21.5-48-48-48s-48 21.5-48 48s21.5 48 48 48M381.7 399.6l-25 62.4l-59.4 59.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l61.7-61.7c4.6-4.6 8.2-10.1 10.6-16.1l14.5-36.2l-40.7-44.4c-2.5-2.7-4.8-5.6-7-8.6z"/>`,
  },
  laptop: {
    source: 'bi:laptop',
    viewBox: '0 0 16 16',
    body: `<path fill="currentColor" d="M13.5 3a.5.5 0 0 1 .5.5V11H2V3.5a.5.5 0 0 1 .5-.5zm-11-1A1.5 1.5 0 0 0 1 3.5V12h14V3.5A1.5 1.5 0 0 0 13.5 2zM0 12.5h16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5"/>`,
  },
};
