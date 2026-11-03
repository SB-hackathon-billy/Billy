import { useQuery } from '@tanstack/react-query';
import {
  AgentTaskDetailSchema,
  CompareOffersResultSchema,
  ExplainTermsResultSchema,
  type AgentTask,
  type RequestView,
} from '@sb/contracts';
import { api, idPath } from '../lib/api.js';

function current(task: AgentTask, view: RequestView, negotiationId?: string) {
  if (task.requestId !== view.request.id || task.status === 'CANCELLED') return false;
  const reference = task.inputVersion;
  if (negotiationId && task.kind === 'EXPLAIN_TERMS' && reference.kind === 'NEGOTIATION') {
    const branch = view.negotiations.find((n) => n.id === negotiationId);
    return (
      branch?.id === reference.negotiationId &&
      branch.version === reference.negotiationVersion &&
      branch.termsRevision === reference.termsRevision
    );
  }
  if (!negotiationId && task.kind === 'COMPARE_OFFERS' && reference.kind === 'COMPARE') {
    const offered = view.negotiations.filter((n) => n.status === 'OFFERED' && n.offer);
    return (
      offered.length > 0 &&
      offered.length === reference.offers.length &&
      offered.every((n) =>
        reference.offers.some(
          (r) =>
            r.negotiationId === n.id &&
            r.offerId === n.offer?.id &&
            r.termsRevision === n.termsRevision,
        ),
      )
    );
  }
  return false;
}
/** Optional prose stays separate from authoritative dates, prices and owner identity. */
export function TaskExplanation({
  view,
  negotiationId,
}: {
  view: RequestView;
  negotiationId?: string;
}) {
  const task = view.tasks.findLast((task) => current(task, view, negotiationId));
  const detail = useQuery({
    queryKey: ['task', task?.id],
    enabled: !!task,
    queryFn: ({ signal }) => api.get(`/tasks/${idPath(task!.id)}`, AgentTaskDetailSchema, signal),
    refetchInterval: (query) =>
      ['QUEUED', 'RUNNING'].includes(query.state.data?.status ?? '') ? 2000 : false,
  });
  if (!task || !detail.data || !current(detail.data, view, negotiationId)) return null;
  const parsed = negotiationId
    ? ExplainTermsResultSchema.safeParse(detail.data.result)
    : CompareOffersResultSchema.safeParse(detail.data.result);
  if (detail.data.status !== 'SUCCEEDED' || !parsed.success) return null;
  return (
    <aside className="explanation">
      <strong>조건 차이 안내</strong>
      <p>{parsed.data.summary}</p>
      <span className="field-hint">선택 전 카드의 날짜·장소·총액을 확인해 주세요.</span>
    </aside>
  );
}
