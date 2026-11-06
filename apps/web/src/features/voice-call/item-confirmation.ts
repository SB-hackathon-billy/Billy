import type { NeedDraft, VoiceCompletion } from '@sb/contracts';

/** Dates and places can change without asking the user to confirm the same item again. */
export function itemConfirmationKey(need: NeedDraft): string | null {
  const name = need.queryText.trim();
  return name && need.category ? JSON.stringify([need.category, name]) : null;
}

/** The server clears completion on each new input, even while it still exposes the old form. */
export function hasCurrentVoiceCompletion(
  snapshot: { inputRevision: number; completion: VoiceCompletion | null } | null,
  taskId: string | undefined,
): boolean {
  return (
    !!snapshot?.completion &&
    snapshot.completion.taskId === taskId &&
    snapshot.completion.inputRevision === snapshot.inputRevision
  );
}
