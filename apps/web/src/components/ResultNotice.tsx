import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSync } from '../lib/session.js';
import { ActionButton } from './ui.js';

export function ResultNotice() {
  const sync = useSync();
  const seen = useRef(new Map<string, string>());
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    for (const request of sync.data?.requestSummaries ?? []) {
      const before = seen.current.get(request.id);
      const fingerprint = `${request.status}:${request.updatedAt}`;
      seen.current.set(request.id, fingerprint);
      if (before === fingerprint) continue;
      const text =
        request.status === 'MATCHES_READY'
          ? `${request.needSummary.queryText} 조회 결과가 도착했어요.`
          : request.status === 'NO_MATCH'
            ? `${request.needSummary.queryText} 조건에 맞는 등록 물품이 없어요.`
            : request.status === 'FAILED'
              ? '조회하지 못했어요. 요청함에서 확인해 주세요.'
              : request.status === 'DRAFT' && request.needSummary.queryText
                ? '신청서를 저장했어요. 요청함에서 부족한 정보를 확인해 주세요.'
                : null;
      // Snapshot restoration also reveals completed work after returning to the app.
      if (text) setNotice({ id: request.id, text });
    }
  }, [sync.data]);
  return notice ? (
    <aside className="result-notice" role="status">
      <p>{notice.text}</p>
      <Link to={`/requests/${notice.id}`} onClick={() => setNotice(null)}>
        요청함의 결과 보기
      </Link>
      <ActionButton secondary onPress={() => setNotice(null)}>
        알림 닫기
      </ActionButton>
    </aside>
  ) : null;
}
