// 신청완료 시트의 정책 안내 카드(정책 1개 = 가로로 긴 카드 1개). 명세: docs/specs/0005-call-policy-guidance.md
import { Link } from 'react-router-dom';
import { PostArtwork } from '../center-board/Artwork.js';
import { policyCard, type PolicyCardSelection } from './policy-match.js';

export function PolicyCards({ selection }: { selection: PolicyCardSelection }) {
  if (selection.kind === 'pending')
    return (
      <section className="vc-policies" aria-labelledby="vc-policies-title" aria-busy="true">
        <h3 id="vc-policies-title">맞춤 정책을 찾고 있어요</h3>
        <div className="vc-policy-card placeholder" aria-hidden="true" />
      </section>
    );
  return (
    <section className="vc-policies" aria-labelledby="vc-policies-title">
      <h3 id="vc-policies-title">
        {selection.kind === 'matched' ? '말씀하신 상황에 맞는 정책이에요' : '이런 정책도 있어요'}
      </h3>
      {selection.kind === 'matched' && selection.situation && (
        <p className="vc-policies-situation">통화에서 확인한 상황 · {selection.situation}</p>
      )}
      <ul>
        {selection.policyIds.map(policyCard).map((card) => (
          <li key={card.id}>
            <Link className="vc-policy-card" to={card.to}>
              <PostArtwork artwork={card.artwork} />
              <span>
                <strong>{card.title}</strong>
                <small>{card.summary}</small>
              </span>
              <span className="vc-policy-arrow" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
