import {
  AiTaskInputSchema,
  AiTaskResultSchema,
  canonicalJson,
  validatePeriod,
  type AiTaskInput,
  type AiTaskResult,
  type ExtractNeedInput,
  type ExtractNeedResult,
  type NeedField,
  type ChangedField,
} from '@sb/contracts';
import { AiAdapterError } from './runtime.js';

export function checkedInput(input: AiTaskInput): AiTaskInput {
  const value = AiTaskInputSchema.parse(input);
  if (value.kind === 'EXPLAIN_TERMS' && value.negotiationId !== value.inputVersion.negotiationId)
    throw new AiAdapterError('REFERENCE_MISMATCH');
  if (value.kind === 'COMPARE_OFFERS') {
    const refs = value.context.offers.map(({ negotiationId, offerId, termsRevision }) => ({
      negotiationId,
      offerId,
      termsRevision,
    }));
    if (
      canonicalJson(refs) !== canonicalJson(value.inputVersion.offers) ||
      new Set(refs.map((r) => r.negotiationId)).size !== refs.length
    )
      throw new AiAdapterError('REFERENCE_MISMATCH');
  }
  return value;
}

export function normalizeNeed(
  input: ExtractNeedInput,
  result: ExtractNeedResult,
): ExtractNeedResult {
  const need = {
    ...result.proposedNeed,
    preferredPlaceIds: [...result.proposedNeed.preferredPlaceIds],
  };
  const available = new Set(input.context.places.map((p) => p.id));
  if (
    need.preferredPlaceIds.some((id) => !available.has(id)) ||
    new Set(need.preferredPlaceIds).size !== need.preferredPlaceIds.length
  )
    throw new AiAdapterError('UNKNOWN_PLACE');
  for (const field of ['startAt', 'endAt'] as const) {
    const value = need[field];
    if (
      value &&
      (Date.parse(value) % 1_800_000 !== 0 || Date.parse(value) <= Date.parse(input.serverNow))
    )
      need[field] = null;
  }
  if (
    need.startAt &&
    need.endAt &&
    !validatePeriod(need.startAt, need.endAt, input.serverNow).valid
  )
    need.endAt = null;
  const missingFields: NeedField[] = [];
  for (const field of ['category', 'queryText', 'startAt', 'endAt'] as const)
    if (!need[field]) missingFields.push(field);
  if (!need.preferredPlaceIds.length) missingFields.push('preferredPlaceIds');
  const many =
    /(?:[2-9]\d*|두|세|네|다섯|여섯|여러)\s*(?:개|대|벌|세트)|한꺼번에|여러\s*물품/u.test(
      input.context.text,
    );
  let clarificationQuestion = result.clarificationQuestion;
  if (many)
    clarificationQuestion =
      '물품은 한 번에 하나씩 요청할 수 있어요. 먼저 어떤 물품 한 개를 빌릴까요?';
  else if (missingFields.length && !clarificationQuestion)
    clarificationQuestion = '필요한 물품, 시작·종료 날짜와 시간, 수령할 장소를 확인해 주세요.';
  return { proposedNeed: need, missingFields, clarificationQuestion };
}

/** Strict schemas reject authority-bearing extra fields; references are checked independently. */
export function validateTaskResult(input: AiTaskInput, raw: unknown): AiTaskResult {
  checkedInput(input);
  const parsed = AiTaskResultSchema.safeParse(raw);
  if (!parsed.success) throw new AiAdapterError('INVALID_RESULT');
  const output = parsed.data;
  if (
    output.taskId !== input.taskId ||
    output.kind !== input.kind ||
    canonicalJson(output.inputVersion) !== canonicalJson(input.inputVersion)
  )
    throw new AiAdapterError('REFERENCE_MISMATCH');
  if (output.kind === 'EXTRACT_NEED' && input.kind === 'EXTRACT_NEED')
    output.result = normalizeNeed(input, output.result);
  if (output.kind === 'RECOMMEND_FEE' && input.kind === 'RECOMMEND_FEE') {
    const { reasonCode, feeOptionId } = output.result;
    const c = input.context;
    if (
      !c.allowedReasonCodes.includes(reasonCode) ||
      (reasonCode === 'FLEXIBLE_HANDOFF' && c.preferredPlaceCount <= 1) ||
      (reasonCode === 'REGISTERED_EXTRA_EFFORT' && !c.item.pricingFacts.registeredExtraEffort) ||
      (reasonCode === 'BASELINE' && feeOptionId !== 'STANDARD') ||
      (c.item.source === 'PUBLIC' && (reasonCode !== 'BASELINE' || feeOptionId !== 'STANDARD'))
    )
      throw new AiAdapterError('UNSUPPORTED_FEE_REASON');
  }
  if (output.kind === 'EXPLAIN_TERMS' && input.kind === 'EXPLAIN_TERMS') {
    const mapping = {
      START_AT: 'startAt',
      END_AT: 'endAt',
      PLACE: 'placeId',
      TOTAL_FEE: 'totalFeeKrw',
    } as const;
    const actual = (Object.keys(mapping) as ChangedField[]).filter(
      (key) => input.context.oldTerms[mapping[key]] !== input.context.newTerms[mapping[key]],
    );
    if (canonicalJson([...output.result.changedFields].sort()) !== canonicalJson(actual.sort()))
      throw new AiAdapterError('TERMS_DIFF_MISMATCH');
  }
  if (output.kind === 'COMPARE_OFFERS' && input.kind === 'COMPARE_OFFERS') {
    const expected = input.context.offers.map(({ negotiationId, termsRevision }) => ({
      negotiationId,
      termsRevision,
    }));
    const actual = output.result.rows.map(({ negotiationId, termsRevision }) => ({
      negotiationId,
      termsRevision,
    }));
    if (canonicalJson(actual) !== canonicalJson(expected))
      throw new AiAdapterError('REFERENCE_MISMATCH');
  }
  return AiTaskResultSchema.parse(output);
}
