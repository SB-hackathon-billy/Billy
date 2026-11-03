import { ConfirmedNeedSchema, validatePeriod, type ExtractNeedResult } from '@sb/contracts';

export function currentVoiceTurn(
  state: { active: boolean; inputRevision: number; turnStatus: string },
  revision: number,
): boolean {
  return state.active && state.inputRevision === revision && state.turnStatus === 'READY';
}

/** Optional budget is deliberately excluded; questions and invalid periods prevent closing. */
export function collectionComplete(result: ExtractNeedResult, serverNow: string): boolean {
  if (result.missingFields.length || result.clarificationQuestion !== null) return false;
  const parsed = ConfirmedNeedSchema.safeParse(result.proposedNeed);
  return parsed.success && validatePeriod(parsed.data.startAt, parsed.data.endAt, serverNow).valid;
}
