import type { RequestView } from '@sb/contracts';
import type { Database, Session } from '@sb/db';

/** Only API-owned identity enters this binding; model data cannot choose an actor or resource. */
export interface VoiceAuthority {
  id: string;
  requestId: string;
  session: Session;
  token: string;
}
export function verifiedVoiceContext(view: RequestView): string {
  return JSON.stringify({
    requestId: view.request.id,
    status: view.request.status,
    need: view.request.need,
    needRevision: view.request.needRevision,
    negotiations: view.negotiations.map((n) => ({ id: n.id, status: n.status, terms: n.terms })),
    notice:
      '통화 중 신청서만 채웁니다. 필수 정보 수집 완료 안내 후 자동 종료하거나 통화 종료·조회 버튼을 누른 뒤 조회합니다. 실제 결제와 예약은 이루어지지 않습니다.',
  });
}

/** Fixed read + proposal binding. No name-based dispatch or business mutation tools. */
export async function proposeVoiceSummary(
  db: Database,
  authority: VoiceAuthority,
  text: string,
  isCurrent: () => boolean,
) {
  if (!isCurrent() || !text.trim()) return null;
  return db.transaction(async (u) => {
    const session = await u.session(authority.token);
    if (session.id !== authority.session.id || !isCurrent()) return null;
    const view = await u.getRequest(session.userId, authority.requestId);
    if (!isCurrent() || view.request.status !== 'DRAFT') return null;
    const accepted = await u.agentTurn(
      session.userId,
      {
        requestId: authority.requestId,
        text: text.trim().slice(-2000),
        expectedRequestVersion: view.request.version,
      },
      { voiceSessionId: authority.id },
    );
    return { ...accepted, context: verifiedVoiceContext(view) };
  });
}
