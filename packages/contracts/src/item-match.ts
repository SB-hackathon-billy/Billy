import type { Item } from './entities.js';

// Match a concrete item name, never just its broad category. Unknown items fail closed.
const aliases = [
  ['프로젝터', '빔프로젝터', '빔 프로젝터', 'projector'],
  ['여행 가방', '여행가방', '캐리어', 'suitcase'],
  ['청소기', 'vacuum'],
  ['사다리', 'ladder'],
  ['공구 세트', '공구세트', '공구함'],
  ['드라이버', '스크루드라이버', 'screwdriver'],
];
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export function matchesItem(query: string, item: Pick<Item, 'title'>): boolean {
  const needle = normalize(query);
  const title = normalize(item.title);
  const groups = aliases.filter((group) => group.some((word) => needle.includes(normalize(word))));
  if (groups.length)
    return groups.every((group) => group.some((word) => title.includes(normalize(word))));
  return needle.length >= 2 && title.includes(needle);
}
