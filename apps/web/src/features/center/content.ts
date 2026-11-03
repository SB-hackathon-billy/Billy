import {
  CenterContentSchema,
  CONTRACT_VERSION,
  formatSeoulDateTime,
  type CenterContent,
} from '@sb/contracts';
import catalog from './catalog.generated.json';

export const CENTER_CONTENT_VERSION = catalog.contentVersion;
if (catalog.contractVersion !== CONTRACT_VERSION) throw new Error('센터 콘텐츠 계약 버전 불일치');
export type CenterDisplay = (typeof catalog.items)[number]['display'];
export type CenterRecord = CenterContent & { display: CenterDisplay };
export const centerContent: CenterRecord[] = catalog.items.map(({ content, display }) => ({
  ...CenterContentSchema.parse(content),
  display,
}));
export const categories = [
  '심리 정서 지원',
  '사회적 관계망 지원',
  '교육 및 여가문화',
  '기타 생활 지원',
] as const;
export const findCenterContent = (id: string) => centerContent.find((item) => item.id === id);
export const formatCenterDate = (date: string) =>
  formatSeoulDateTime(new Date(`${date}T00:00:00+09:00`)).replace(/ 00:00$/, '');
export function filterCenterContent(
  items: CenterRecord[],
  query: string,
  filters: { category?: string; status?: string; weekday?: string; date?: string } = {},
) {
  const normalized = query.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  return items.filter((item) => {
    const day = item.display.startAt ? new Date(item.display.startAt) : null;
    return (
      (!normalized ||
        `${item.title} ${item.summary}`
          .normalize('NFC')
          .toLocaleLowerCase('ko-KR')
          .includes(normalized)) &&
      (!filters.category || item.display.category === filters.category) &&
      (!filters.status || item.display.status === filters.status) &&
      (!filters.weekday ||
        (day &&
          new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(
            day,
          ) === filters.weekday)) &&
      (!filters.date ||
        (day &&
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(day) === filters.date))
    );
  });
}
