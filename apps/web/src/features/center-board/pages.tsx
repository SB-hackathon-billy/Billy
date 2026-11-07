// 센터 서비스 시연: 실제 게시글을 리디자인한 앱에서 보여 주고, 센터 기존 서비스를 탭으로 연결한다.
// 물품대여만 이 앱의 통화 접수로 연결되고, 나머지 서비스는 연동하지 않은 시연 화면이다(네트워크 쓰기 없음).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { ExternalLink } from '../center/shared.js';
import { PostArtwork, PostIcon } from './Artwork.js';
import {
  BOARD_LABELS,
  CENTER_PROFILE,
  centerServices,
  findPost,
  findService,
  formatPostDate,
  sortedPosts,
  type BoardKind,
  type CenterPost,
} from './posts.js';
import './center-board.css';

const filters: (BoardKind | 'ALL')[] = ['ALL', 'NOTICE', 'RECRUIT', 'NEWS'];

export function BoardPage() {
  const [board, setBoard] = useState<BoardKind | 'ALL'>('ALL');
  const posts = sortedPosts(board);
  return (
    <section className="cb-page" aria-labelledby="cb-board-title">
      <header className="cb-hero">
        <h1 id="cb-board-title">
          <span className="cb-hl">성북구</span> {CENTER_PROFILE.name.replace(/^성북구\s*/, '')} 소식
        </h1>
        <p>센터 공지와 활동 소식을 모바일에서 한눈에 확인하세요.</p>
      </header>
      <ServiceStrip />
      <div className="cb-filters" role="group" aria-label="게시판 분류">
        {filters.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={board === value}
            onClick={() => setBoard(value)}
          >
            {value === 'ALL' ? '전체' : BOARD_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="cb-count" role="status">
        게시글 {posts.length}개
      </p>
      <ul className="cb-list">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <a
        className="button cb-site"
        href={CENTER_PROFILE.site}
        target="_blank"
        rel="noopener noreferrer"
      >
        센터 공식 사이트 <span aria-hidden="true">↗</span>
        <span className="visually-hidden"> (새 창)</span>
      </a>
      <SourceNote />
    </section>
  );
}

function PostCard({ post }: { post: CenterPost }) {
  return (
    <Link className="cb-card" to={`/center/board/${post.id}`}>
      <PostIcon artwork={post.artwork} />
      <span className="cb-card-body">
        <span className="cb-tags">
          {post.pinned && <span className="cb-tag pinned">고정</span>}
          <span className={`cb-tag ${post.board.toLowerCase()}`}>{BOARD_LABELS[post.board]}</span>
        </span>
        <strong>{post.title}</strong>
        <span className="cb-summary">{post.summary}</span>
        <span className="cb-meta">
          {formatPostDate(post.date, post.board)} · {post.source.label}
        </span>
      </span>
    </Link>
  );
}

export function PostPage() {
  const { id = '' } = useParams();
  const post = findPost(id);
  if (!post)
    return (
      <section className="cb-page">
        <h1>게시글을 찾을 수 없어요</h1>
        <Link to="/center/board">소식 목록으로</Link>
      </section>
    );
  return (
    <article className="cb-page cb-article" aria-labelledby="cb-post-title">
      <Link className="cb-back" to="/center/board">
        ← 소식 목록
      </Link>
      <div className="cb-article-art">
        <PostArtwork artwork={post.artwork} label={`${post.title} 일러스트`} />
      </div>
      <p className="cb-tags">
        <span className={`cb-tag ${post.board.toLowerCase()}`}>{BOARD_LABELS[post.board]}</span>
      </p>
      <h1 id="cb-post-title">{post.title}</h1>
      <p className="cb-meta">
        {formatPostDate(post.date, post.board)} · {CENTER_PROFILE.name}
      </p>
      {post.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {post.facts.length > 0 && (
        <dl className="cb-facts">
          {post.facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {post.action && (
        <Link className="button" to={post.action.to}>
          {post.action.label}
        </Link>
      )}
      <p className="cb-source">
        출처 <ExternalLink href={post.source.url}>{post.source.label}</ExternalLink>
      </p>
      <SourceNote />
    </article>
  );
}

function ServiceStrip() {
  return (
    <nav className="cb-strip" aria-label="센터 서비스 바로가기">
      {centerServices.map((service) => (
        <Link key={service.id} to={service.connectedTo ?? `/center/services/${service.id}`}>
          <PostIcon artwork={service.artwork} />
          <span>{service.title}</span>
        </Link>
      ))}
    </nav>
  );
}

export function ServicesPage() {
  return (
    <section className="cb-page" aria-labelledby="cb-services-title">
      <header className="cb-hero">
        <h1 id="cb-services-title">센터에서 이용할 수 있어요</h1>
        <p>센터가 운영하는 서비스를 한곳에 모았어요. 물품대여는 앱에서 바로 신청할 수 있어요.</p>
      </header>
      <ul className="cb-services">
        {centerServices.map((service) => (
          <li key={service.id}>
            <Link
              className="cb-service"
              to={service.connectedTo ?? `/center/services/${service.id}`}
            >
              <PostArtwork artwork={service.artwork} />
              <span>
                <strong>{service.title}</strong>
                <span>{service.summary}</span>
                <em>{service.connectedTo ? '앱에서 바로 신청' : '자세히 보기'}</em>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <SourceNote />
    </section>
  );
}

export function ServicePage() {
  const { id = '' } = useParams();
  const service = findService(id);
  const [open, setOpen] = useState(false);
  if (!service)
    return (
      <section className="cb-page">
        <h1>서비스를 찾을 수 없어요</h1>
        <Link to="/center/services">센터 서비스로</Link>
      </section>
    );
  return (
    <section className="cb-page cb-article" aria-labelledby="cb-service-title">
      <Link className="cb-back" to="/center/services">
        ← 센터 서비스
      </Link>
      <div className="cb-article-art">
        <PostArtwork artwork={service.artwork} />
      </div>
      <h1 id="cb-service-title">{service.title}</h1>
      <p>{service.summary}</p>
      <h2>이용 방법</h2>
      <ul className="cb-bullets">
        {service.current.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {service.connectedTo ? (
        <Link className="button" to={service.connectedTo}>
          상담 통화로 신청하기
        </Link>
      ) : (
        <button type="button" className="button" onClick={() => setOpen(true)}>
          신청하기
        </button>
      )}
      <ModalOverlay className="cb-overlay" isDismissable isOpen={open} onOpenChange={setOpen}>
        <Modal className="cb-modal">
          <Dialog aria-label={`${service.title} 신청 시연`}>
            <Heading slot="title">{service.title} 신청</Heading>
            <ul className="cb-bullets">
              {service.demoFields?.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
            <p className="cb-meta">
              실제 신청은 <ExternalLink href={CENTER_PROFILE.site}>센터 공식 사이트</ExternalLink>
              에서 할 수 있어요.
            </p>
            <button type="button" className="button secondary" onClick={() => setOpen(false)}>
              닫기
            </button>
          </Dialog>
        </Modal>
      </ModalOverlay>
      <SourceNote />
    </section>
  );
}

function SourceNote() {
  return (
    <p className="cb-note">
      이미지는 원본 사진 대신 쓴 일러스트이며, 최신 내용은 원문과{' '}
      <ExternalLink href={CENTER_PROFILE.site}>센터 공식 사이트</ExternalLink>
      에서 확인해 주세요. 문의 {CENTER_PROFILE.phone}
    </p>
  );
}
