import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Label, TextArea, TextField } from 'react-aria-components';
import { formatSeoulDateTime } from '@sb/contracts';
import {
  centerContent,
  categories,
  filterCenterContent,
  formatCenterDate,
  findCenterContent,
  type CenterRecord,
} from './content.js';
import {
  CenterCalendar,
  ChoiceTabs,
  ContentBody,
  ContentCard,
  DemoNotice,
  DetailHeader,
  EmptyState,
  ExternalLink,
  Illustration,
  InterestButton,
  NotFoundContent,
  PageHeading,
  Search,
  Sheet,
} from './shared.js';
import {
  FormPreview,
  SpacePreview,
  validateSpaceDraft,
  type PreviewKind,
  type SpaceDraft,
} from './forms.js';

const programs = centerContent.filter((item) => item.type === 'PROGRAM');
const cards = (items: CenterRecord[], base: string) => (
  <div className="center-card-list">
    {items.map((item) => (
      <ContentCard key={item.id} item={item} base={base} />
    ))}
  </div>
);

export function AboutPage() {
  const [tab, setTab] = useState('intro');
  return (
    <section>
      <div className="center-hero">
        <PageHeading title="혼자여도, 함께하는 일상">
          동네에서 만나는 작은 연결.
          <br />
          나에게 맞는 시간을 찾아보세요.
        </PageHeading>
        <Illustration id="sharing-home" />
      </div>
      <ChoiceTabs
        label="센터 소개 내용"
        choices={[
          ['intro', '센터 소개'],
          ['guide', '이용안내'],
          ['location', '오시는 길'],
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'intro' && (
          <>
            <ContentBody item={findCenterContent('center-about')!} />
            <div className="center-surface">
              <h2>성북복지재단과 함께</h2>
              <ContentBody item={findCenterContent('center-foundation')!} />
              <ExternalLink href="https://sb1in.or.kr/about/history">
                센터 히스토리 살펴보기
              </ExternalLink>
            </div>
            <h2 className="center-section-title">일상을 넓히는 네 가지 연결</h2>
            <div className="center-category-grid">
              {categories.map((category, index) => (
                <Link
                  key={category}
                  to={`/center/business?category=${encodeURIComponent(category)}`}
                >
                  <span aria-hidden="true">0{index + 1}</span>
                  {category}
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
            <Link className="button" to="/rental">
              공공·이웃 물품 공유대여 살펴보기
            </Link>
          </>
        )}
        {tab === 'guide' && (
          <>
            <h2>나에게 맞는 이용 방법</h2>
            <ContentBody item={findCenterContent('center-guide')!} />
            <ol className="center-steps">
              <li>관심 있는 활동과 이용 대상을 확인해요.</li>
              <li>실제 이용은 공식 센터 안내를 따라요.</li>
            </ol>
            <div className="center-surface">
              <h3>기존 사이트 안내</h3>
              <ExternalLink href="https://sb1in.or.kr/register">
                기존 회원가입·인증 안내
              </ExternalLink>
              <ExternalLink href="https://sb1in.or.kr/partner">기존 협력기관포털</ExternalLink>
            </div>
          </>
        )}
        {tab === 'location' && (
          <>
            <div className="center-location-art" aria-hidden="true">
              <span>성북구</span>
              <div>
                장위로8길
                <br />
                <strong>● 센터</strong>
              </div>
              <span>위치 안내용 그림</span>
            </div>
            <h2>{findCenterContent('center-directions')!.summary}</h2>
            <ContentBody item={findCenterContent('center-directions')!} />
            <ExternalLink href="https://map.kakao.com/link/search/성북구1인가구지원센터">
              지도에서 길찾기
            </ExternalLink>
          </>
        )}
      </ChoiceTabs>
    </section>
  );
}

export function BusinessPage() {
  const initial = new URLSearchParams(window.location.search).get('category') ?? '';
  const [category, setCategory] = useState(
    categories.some((value) => value === initial) ? initial : '',
  );
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [weekday, setWeekday] = useState('');
  const [view, setView] = useState('list');
  const [date, setDate] = useState('2026-11-07');
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = filterCenterContent(programs, query, {
    category,
    status,
    weekday,
    ...(view === 'calendar' ? { date } : {}),
  });
  const reset = () => {
    setCategory('');
    setQuery('');
    setStatus('');
    setWeekday('');
    setView('list');
  };
  return (
    <section>
      <PageHeading title="일상에 더하는 연결">마음 돌봄부터 생활의 작은 배움까지.</PageHeading>
      <DemoNotice>2026년 11월의 합성 일정입니다. 실제 모집·운영 일정이 아닙니다.</DemoNotice>
      <div className="center-chips" aria-label="사업 분류">
        {categories.map((value) => (
          <Button
            key={value}
            aria-pressed={category === value}
            onPress={() => setCategory(category === value ? '' : value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <Search value={query} onChange={setQuery} label="사업 검색" />
      <div className="center-toolbar">
        <Button className="center-button" onPress={() => setFilterOpen(true)}>
          조건 필터{status || weekday ? ' · 적용 중' : ''}
        </Button>
        <Button className="center-button center-text-button" onPress={reset}>
          전체 보기
        </Button>
      </div>
      {(category || status || weekday) && (
        <p className="center-filter-summary" role="status">
          선택 조건:{' '}
          {[category, status, weekday ? `${weekday}요일` : ''].filter(Boolean).join(' · ')}
        </p>
      )}
      <ChoiceTabs
        label="사업 보기 방식"
        choices={[
          ['list', '목록'],
          ['calendar', '달력'],
        ]}
        value={view}
        onChange={setView}
      >
        {view === 'calendar' && (
          <>
            <CenterCalendar
              value={date}
              onChange={setDate}
              eventDates={programs.map((item) => item.display.startAt.slice(0, 10))}
            />
            <p className="center-calendar-legend">
              밑줄: 예시 일정이 있는 날 · {formatCenterDate(date)} 선택
            </p>
          </>
        )}
        <p className="center-result-count" role="status">
          {filtered.length}개의 사업 예시
        </p>
        {filtered.length ? cards(filtered, '/center/business') : <EmptyState reset={reset} />}
      </ChoiceTabs>
      <Sheet title="사업 조건 필터" isOpen={filterOpen} onClose={() => setFilterOpen(false)}>
        <div className="center-form">
          <label>
            모집 상태
            <select
              aria-label="모집 상태"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">전체 상태</option>
              {['모집 예시', '예정 예시', '마감 예시'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            진행 요일
            <select
              aria-label="진행 요일"
              value={weekday}
              onChange={(event) => setWeekday(event.target.value)}
            >
              <option value="">모든 요일</option>
              {['월', '화', '수', '목', '금', '토', '일'].map((value) => (
                <option key={value} value={value}>
                  {value}요일
                </option>
              ))}
            </select>
          </label>
          <Button className="button" onPress={() => setFilterOpen(false)}>
            필터 적용
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

export function ProgramsPage() {
  const [query, setQuery] = useState('');
  const filtered = filterCenterContent(programs, query);
  return (
    <section>
      <PageHeading title="나를 위한 작은 시간">함께 배우고, 만나고, 쉬어가는 프로그램.</PageHeading>
      <DemoNotice />
      <Search value={query} onChange={setQuery} label="프로그램 검색" />
      <p className="center-result-count" role="status">
        {filtered.length}개의 프로그램 예시
      </p>
      {filtered.length ? (
        cards(filtered, '/center/programs')
      ) : (
        <EmptyState reset={() => setQuery('')} />
      )}
    </section>
  );
}
export function ProgramDetail({ business = false }: { business?: boolean }) {
  const { id = '' } = useParams();
  const [preview, setPreview] = useState(false);
  const item = findCenterContent(id);
  const back = business ? '/center/business' : '/center/programs';
  if (!item || item.type !== 'PROGRAM') return <NotFoundContent back={back} />;
  return (
    <section>
      <DetailHeader item={item} back={back} backLabel={business ? '사업 목록' : '프로그램 목록'} />
      <div className="center-detail-art">
        <Illustration id={item.display.category === '기타 생활 지원' ? 'tools' : 'hobby'} />
      </div>
      <div className="center-tags">
        <span className="center-tag">{item.display.category}</span>
        <span>{item.display.status}</span>
      </div>
      <dl className="center-facts">
        <div>
          <dt>일정 (예시)</dt>
          <dd>
            {formatSeoulDateTime(item.display.startAt)}
            <br />– {formatSeoulDateTime(item.display.endAt)}
          </dd>
        </div>
        <div>
          <dt>대상 (예시)</dt>
          <dd>{item.display.audience}</dd>
        </div>
        <div>
          <dt>장소 (예시)</dt>
          <dd>{item.display.venue}</dd>
        </div>
        <div>
          <dt>진행 절차</dt>
          <dd>{item.display.process}</dd>
        </div>
      </dl>
      <ContentBody item={item} />
      <div className="center-actions">
        <Button className="button" onPress={() => setPreview(true)}>
          신청 양식 살펴보기
        </Button>
        <InterestButton item={item} />
      </div>
      {preview && <FormPreview item={item} kind="program" onClose={() => setPreview(false)} />}
    </section>
  );
}

export function ClubsPage() {
  const [tab, setTab] = useState('모집');
  const [query, setQuery] = useState('');
  const filtered = filterCenterContent(
    centerContent.filter((item) => item.type === 'CLUB'),
    query,
    { status: tab },
  );
  return (
    <section>
      <PageHeading title="좋아하는 일을, 함께">작은 관심사가 이웃과 만나는 시간.</PageHeading>
      <DemoNotice />
      <Search value={query} onChange={setQuery} label="동아리 검색" />
      <ChoiceTabs
        label="동아리 내용"
        choices={[
          ['모집', '모집 예시'],
          ['활동', '활동 이야기'],
        ]}
        value={tab}
        onChange={setTab}
      >
        <p className="center-result-count" role="status">
          {filtered.length}개의 동아리 예시
        </p>
        {filtered.length ? (
          cards(filtered, '/center/clubs')
        ) : (
          <EmptyState
            reset={() => {
              setQuery('');
              setTab('모집');
            }}
          />
        )}
      </ChoiceTabs>
    </section>
  );
}
export function ClubDetail() {
  const { id = '' } = useParams();
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const item = findCenterContent(id);
  if (!item || item.type !== 'CLUB') return <NotFoundContent back="/center/clubs" />;
  return (
    <section>
      <DetailHeader item={item} back="/center/clubs" backLabel="동아리 목록" />
      <div className="center-detail-art">
        <Illustration id="center-garden" />
      </div>
      <dl className="center-facts">
        <div>
          <dt>활동 분야</dt>
          <dd>{item.display.category}</dd>
        </div>
        <div>
          <dt>만나는 곳 (예시)</dt>
          <dd>{item.display.venue}</dd>
        </div>
        <div>
          <dt>참여 대상 (예시)</dt>
          <dd>{item.display.audience}</dd>
        </div>
      </dl>
      <ContentBody item={item} />
      <div className="center-surface">
        <h2>내 역할에 맞는 양식 보기</h2>
        <p>
          리더·팀원·활동보고의 각 양식을 살펴보세요. 초대·서류 제출·심사·보고 저장은 진행되지
          않습니다.
        </p>
        <div className="center-stacked-actions">
          <Button className="button" onPress={() => setKind('leader')}>
            리더 참여 양식
          </Button>
          <Button className="button secondary" onPress={() => setKind('member')}>
            팀원 참여 양식
          </Button>
          <Button className="button secondary" onPress={() => setKind('report')}>
            활동보고 양식
          </Button>
        </div>
      </div>
      {kind && <FormPreview key={kind} item={item} kind={kind} onClose={() => setKind(null)} />}
    </section>
  );
}

export function SpacesPage() {
  const [query, setQuery] = useState('');
  const filtered = filterCenterContent(
    centerContent.filter((item) => item.type === 'SPACE'),
    query,
  );
  return (
    <section>
      <PageHeading title="같이 머무는 공간">잠깐 모여 이야기하고, 배움을 나눠요.</PageHeading>
      <DemoNotice>공간·수용 인원은 예시입니다. 실제 신청·예약되지 않습니다.</DemoNotice>
      <Search value={query} onChange={setQuery} label="공간 검색" />
      <p className="center-result-count" role="status">
        {filtered.length}개의 공간 예시
      </p>
      {filtered.length ? (
        cards(filtered, '/center/spaces')
      ) : (
        <EmptyState reset={() => setQuery('')} />
      )}
    </section>
  );
}
export function SpaceDetail() {
  const { id = '' } = useParams();
  const [draft, setDraft] = useState<SpaceDraft>({
    date: '2026-11-07',
    start: '10:00',
    end: '12:00',
    people: '2',
    purpose: '이웃과 독서 모임 (예시)',
  });
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const item = findCenterContent(id);
  const update = (key: keyof SpaceDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError('');
  };
  if (!item || item.type !== 'SPACE') return <NotFoundContent back="/center/spaces" />;
  const times = Array.from(
    { length: 10 },
    (_, index) => `${String(index + 9).padStart(2, '0')}:00`,
  );
  return (
    <section>
      <DetailHeader item={item} back="/center/spaces" backLabel="공간 목록" />
      <img className="center-space-image" src={item.images[0]?.url} alt={item.images[0]?.alt} />
      <p className="center-image-caption">실제 시설 사진이 아닌 자체 일러스트</p>
      <dl className="center-facts">
        <div>
          <dt>인원 안내 (예시)</dt>
          <dd>최대 {item.display.capacity}명</dd>
        </div>
        <div>
          <dt>공간 구성</dt>
          <dd>{item.display.features.join(' · ')}</dd>
        </div>
      </dl>
      <ContentBody item={item} />
      <h2 className="center-section-title">예약 양식을 살펴보세요</h2>
      <p>선택 가능한 날짜와 시간은 화면 예시이며, 실제 운영시간·가용 현황을 뜻하지 않습니다.</p>
      <CenterCalendar
        value={draft.date}
        onChange={(value) => update('date', value)}
        label="예약 날짜 예시 선택"
      />
      <div className="center-form">
        <div className="center-time-grid">
          <label>
            시작 시간
            <select
              aria-label="시작 시간"
              value={draft.start}
              onChange={(event) => update('start', event.target.value)}
            >
              {times.slice(0, -1).map((time) => (
                <option key={time}>{time}</option>
              ))}
            </select>
          </label>
          <label>
            종료 시간
            <select
              aria-label="종료 시간"
              value={draft.end}
              onChange={(event) => update('end', event.target.value)}
            >
              {times.slice(1).map((time) => (
                <option key={time}>{time}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          이용 인원 (예시)
          <select
            aria-label="이용 인원 (예시)"
            value={draft.people}
            onChange={(event) => update('people', event.target.value)}
          >
            {Array.from({ length: item.display.capacity }, (_, index) => (
              <option key={index} value={index + 1}>
                {index + 1}명
              </option>
            ))}
          </select>
        </label>
        <TextField value={draft.purpose} onChange={(value) => update('purpose', value)}>
          <Label>이용 목적 (실제 개인정보 제외)</Label>
          <TextArea maxLength={300} rows={3} />
        </TextField>
        {error && (
          <p className="center-field-error" role="alert">
            {error}
          </p>
        )}
        <Button
          className="button"
          onPress={() => {
            const message = validateSpaceDraft(draft);
            setError(message);
            if (!message) setPreview(true);
          }}
        >
          예약 미리보기
        </Button>
      </div>
      {preview && <SpacePreview item={item} draft={draft} onClose={() => setPreview(false)} />}
    </section>
  );
}

export function NewsPage() {
  const [tab, setTab] = useState('NOTICE');
  const [query, setQuery] = useState('');
  const filtered = filterCenterContent(
    centerContent.filter((item) => item.type === tab),
    query,
  );
  return (
    <section>
      <PageHeading title="우리 동네의 이야기">센터에서 이어지는 소소한 일상을 만나요.</PageHeading>
      <DemoNotice />
      <Search value={query} onChange={setQuery} label="소식 제목 검색" />
      <ChoiceTabs
        label="소식 종류"
        choices={[
          ['NOTICE', '공지'],
          ['PRESS', '보도'],
          ['GALLERY', '사진첩'],
        ]}
        value={tab}
        onChange={setTab}
      >
        <p className="center-result-count" role="status">
          {filtered.length}개의 소식 예시
        </p>
        {filtered.length ? (
          cards(filtered, '/center/news')
        ) : (
          <EmptyState reset={() => setQuery('')} />
        )}
      </ChoiceTabs>
    </section>
  );
}
export function NewsDetail() {
  const { id = '' } = useParams();
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const item = findCenterContent(id);
  if (!item || !['NOTICE', 'PRESS', 'GALLERY'].includes(item.type))
    return <NotFoundContent back="/center/news" />;
  const selectedImage = imageIndex !== null ? item.images[imageIndex] : undefined;
  return (
    <section>
      <DetailHeader item={item} back="/center/news" backLabel="소식 목록" />
      <p>예시 작성일 · {formatSeoulDateTime(item.updatedAt)}</p>
      <ContentBody item={item} />
      {item.images.length > 0 && (
        <>
          <h2 className="center-section-title">합성 일러스트 갤러리</h2>
          <p>실제 참여자 사진이 아닙니다. 그림을 누르면 크게 볼 수 있어요.</p>
          <div className="center-gallery">
            {item.images.map((img, index) => (
              <Button
                key={img.url}
                aria-label={`그림 ${index + 1} 크게 보기: ${img.alt}`}
                onPress={() => setImageIndex(index)}
              >
                <img src={img.url} alt={img.alt} />
                <span>그림 {index + 1} 크게 보기 ↗</span>
              </Button>
            ))}
          </div>
        </>
      )}
      {selectedImage && (
        <Sheet
          title={`그림 ${(imageIndex ?? 0) + 1} / ${item.images.length}`}
          isOpen
          onClose={() => setImageIndex(null)}
        >
          <img
            className="center-gallery-enlarged"
            src={selectedImage.url}
            alt={selectedImage.alt}
          />
          <p>{selectedImage.alt}</p>
          <div className="center-actions center-actions-row">
            <Button
              className="button secondary"
              onPress={() =>
                setImageIndex(((imageIndex ?? 0) + item.images.length - 1) % item.images.length)
              }
            >
              이전 그림
            </Button>
            <Button
              className="button secondary"
              onPress={() => setImageIndex(((imageIndex ?? 0) + 1) % item.images.length)}
            >
              다음 그림
            </Button>
          </div>
          <Button className="button secondary center-wide" onPress={() => setImageIndex(null)}>
            미리보기 닫기
          </Button>
        </Sheet>
      )}
    </section>
  );
}
