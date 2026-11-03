import { expect, it } from 'vitest';
import { matchesItem } from './item-match.js';
it('does not replace a screwdriver with a ladder or assume a tool set contains one', () => {
  expect(matchesItem('드라이버', { title: '공공 사다리' })).toBe(false);
  expect(matchesItem('드라이버', { title: '하나의 공구 세트' })).toBe(false);
  expect(matchesItem('드라이버', { title: '십자 드라이버' })).toBe(true);
  expect(matchesItem('캐리어', { title: '공공 여행 가방' })).toBe(true);
  expect(matchesItem('빔프로젝터를 빌리고 싶어요', { title: '공공 프로젝터' })).toBe(true);
  expect(matchesItem('드라이버와 사다리', { title: '공공 사다리' })).toBe(false);
});
