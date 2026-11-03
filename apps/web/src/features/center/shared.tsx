import { createContext, useContext, useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Dialog,
  Heading,
  I18nProvider,
  Input,
  Label,
  Modal,
  ModalOverlay,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from 'react-aria-components';
import { parseDate, type DateValue } from '@internationalized/date';
import { formatSeoulDateTime } from '@sb/contracts';
import { illustrations, type IllustrationId } from '../../assets/illustrations/manifest.js';
import type { CenterRecord } from './content.js';
import './center.css';

const InterestContext = createContext<{ ids: Set<string>; toggle: (id: string) => void } | null>(
  null,
);
const menu = [
  ['about', '센터 소개'],
  ['business', '사업 안내'],
  ['programs', '프로그램'],
  ['clubs', '동아리'],
  ['spaces', '공간'],
  ['news', '소식'],
] as const;

export function CenterLayout() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <I18nProvider locale="ko-KR">
      <InterestContext.Provider value={{ ids, toggle }}>
        <div className="center-feature">
          <div className="center-masthead">
            <Link to="/center">성북구 1인가구지원센터</Link>
            <span>동네의 연결</span>
          </div>
          <nav className="center-nav" aria-label="센터 메뉴">
            {menu.map(([path, title]) => (
              <NavLink key={path} to={`/center/${path}`}>
                {title}
              </NavLink>
            ))}
          </nav>
          <Outlet />
          <footer className="center-footer">
            <strong>함께 살펴보는 센터 데모</strong>
            <p>
              센터 콘텐츠·모집·양식은 합성 예시입니다. 실제 신청·예약되지 않습니다. 입력과 관심
              표시는 현재 탭의 화면에서만 유지되며 새로고침하거나 센터를 벗어나면 초기화됩니다.
            </p>
            <ExternalLink href="https://sb1in.or.kr/">공식 센터 사이트</ExternalLink>
          </footer>
        </div>
      </InterestContext.Provider>
    </I18nProvider>
  );
}
export function Illustration({ id, className = '' }: { id: IllustrationId; className?: string }) {
  const asset = illustrations[id];
  return (
    <img
      className={`center-illustration ${className}`}
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt=""
      aria-hidden="true"
    />
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="center-page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}
export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="center-demo-notice">
      <span aria-hidden="true">ⓘ </span>
      {children ?? '합성 예시 콘텐츠입니다. 실제 신청·예약되지 않습니다.'}
    </p>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="center-external" href={href} target="_blank" rel="noopener noreferrer">
      {children} <span aria-hidden="true">↗</span>
      <span className="center-sr-only"> (새 창)</span>
    </a>
  );
}
export function Search({
  value,
  onChange,
  label = '제목 검색',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <SearchField className="center-search" value={value} onChange={onChange}>
      <Label>{label}</Label>
      <div>
        <span aria-hidden="true">⌕</span>
        <Input
          placeholder="궁금한 내용을 찾아보세요"
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
        <Button aria-label="검색어 지우기">×</Button>
      </div>
    </SearchField>
  );
}
export function ChoiceTabs({
  label,
  choices,
  value,
  onChange,
  children,
}: {
  label: string;
  choices: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Tabs
      className="center-tabs"
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
    >
      <TabList aria-label={label}>
        {choices.map(([key, title]) => (
          <Tab key={key} id={key}>
            {title}
          </Tab>
        ))}
      </TabList>
      {choices.map(([key]) => (
        <TabPanel key={key} id={key}>
          {key === value ? children : null}
        </TabPanel>
      ))}
    </Tabs>
  );
}
export function EmptyState({
  reset,
  message = '다른 검색어나 조건으로 다시 찾아보세요.',
}: {
  reset: () => void;
  message?: string;
}) {
  return (
    <div className="center-empty" role="status">
      <Illustration id="empty" />
      <h2>아직 보여드릴 내용이 없어요</h2>
      <p>{message}</p>
      <Button className="center-button" onPress={reset}>
        조건 초기화
      </Button>
    </div>
  );
}
export function InterestButton({ item }: { item: CenterRecord }) {
  const context = useContext(InterestContext);
  if (!context) throw new Error('센터 관심 표시는 CenterLayout 안에서 사용해야 합니다.');
  const { ids, toggle } = context;
  const selected = ids.has(item.id);
  return (
    <Button
      className="center-button center-interest"
      aria-pressed={selected}
      onPress={() => toggle(item.id)}
    >
      {selected ? '♥ 관심 표시됨' : '♡ 관심 표시'}
      <span className="center-sr-only">: {item.title}</span>
    </Button>
  );
}
export function ContentCard({ item, base }: { item: CenterRecord; base: string }) {
  return (
    <article className="center-card">
      {item.images[0] && (
        <img
          className="center-card-image"
          src={item.images[0].url}
          alt={item.images[0].alt}
          loading="lazy"
        />
      )}
      <div className="center-card-content">
        <div className="center-tags">
          <span className="center-tag">예시</span>
          {item.display.category && <span>{item.display.category}</span>}
          {item.display.status && (
            <span className="center-tag center-tag-outline">{item.display.status}</span>
          )}
        </div>
        <h2>
          <Link to={`${base}/${item.id}`}>
            {item.title}
            <span aria-hidden="true"> ↗</span>
          </Link>
        </h2>
        <p>{item.summary}</p>
        {item.display.startAt && (
          <p className="center-card-date">{formatSeoulDateTime(item.display.startAt)}</p>
        )}
        {item.display.venue && <p className="center-card-date">{item.display.venue}</p>}
      </div>
    </article>
  );
}
export function ContentBody({ item }: { item: CenterRecord }) {
  return (
    <>
      <div className="center-prose">
        {item.body.split('\n').map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <ExternalLink href={item.sourceUrl}>참고한 공식 메뉴</ExternalLink>
    </>
  );
}
export function DetailHeader({
  item,
  back,
  backLabel,
}: {
  item: CenterRecord;
  back: string;
  backLabel: string;
}) {
  return (
    <>
      <Link className="center-back" to={back}>
        ← {backLabel}
      </Link>
      <PageHeading eyebrow="센터 · 예시 콘텐츠" title={item.title}>
        {item.summary}
      </PageHeading>
      <DemoNotice />
    </>
  );
}
export function NotFoundContent({ back }: { back: string }) {
  return (
    <>
      <PageHeading eyebrow="센터" title="콘텐츠를 찾을 수 없어요">
        주소를 확인하거나 목록에서 다시 골라 주세요.
      </PageHeading>
      <Link className="center-button" to={back}>
        목록으로 돌아가기
      </Link>
    </>
  );
}
export function CenterCalendar({
  value,
  onChange,
  label = '예시 일정 선택',
  eventDates = [],
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  eventDates?: string[];
}) {
  return (
    <Calendar
      className="center-calendar"
      aria-label={label}
      value={parseDate(value)}
      onChange={(date: DateValue) => onChange(date.toString())}
    >
      <header>
        <Button slot="previous" aria-label="이전 달">
          ‹
        </Button>
        <Heading />
        <Button slot="next" aria-label="다음 달">
          ›
        </Button>
      </header>
      <CalendarGrid>
        <CalendarGridHeader>
          {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              date={date}
              className={`center-calendar-cell ${eventDates.includes(date.toString()) ? 'has-event' : ''}`}
            >
              {({ formattedDate }) => (
                <>
                  {formattedDate}
                  {eventDates.includes(date.toString()) && (
                    <span className="center-sr-only">, 예시 일정 있음</span>
                  )}
                </>
              )}
            </CalendarCell>
          )}
        </CalendarGridBody>
      </CalendarGrid>
    </Calendar>
  );
}
export function Sheet({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      className="center-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
    >
      <Modal className="center-sheet">
        <Dialog>
          <div className="center-sheet-top">
            <Heading slot="title">{title}</Heading>
            <Button className="center-icon-button" aria-label="미리보기 닫기" onPress={onClose}>
              ×
            </Button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
