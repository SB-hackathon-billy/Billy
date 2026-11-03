import { readFileSync } from 'node:fs';
import {
  AiTaskInputSchema,
  AiTaskResultSchema,
  canonicalJson,
  type AiTaskInput,
  type AiTaskResult,
  type ChangedField,
} from '@sb/contracts';
import { AiAdapterError } from './runtime.js';
import type { AiTransport } from './transport.js';

export type FixtureScenario =
  | 'normal'
  | 'failure'
  | 'timeout'
  | 'invalid-option'
  | 'unsupported-reason'
  | 'authority-injection'
  | 'unclear';
export interface FixtureOptions {
  scenario?: FixtureScenario;
  /** Override a complete output envelope to exercise stale-result checks. */
  results?: Partial<Record<AiTaskInput['kind'], unknown>>;
}
const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${file}.json`, import.meta.url), 'utf8')) as unknown;
const kinds = [
  'ROUTE_INTENT',
  'EXTRACT_NEED',
  'RECOMMEND_FEE',
  'EXPLAIN_TERMS',
  'COMPARE_OFFERS',
] as const;
export const AI_FIXTURES = Object.fromEntries(
  kinds.map((kind) => {
    const value = read(kind.toLowerCase()) as { input: unknown; output: unknown };
    return [
      kind,
      {
        input: AiTaskInputSchema.parse(value.input),
        output: AiTaskResultSchema.parse(value.output),
      },
    ];
  }),
) as Record<AiTaskInput['kind'], { input: AiTaskInput; output: AiTaskResult }>;
const failures = read('failures') as Record<string, Record<string, unknown>>;

/** Explicit test mode. Fixed JSON outputs with only input-reference/date interpolation. */
export class FixtureTransport implements AiTransport {
  constructor(private readonly options: FixtureOptions = {}) {}
  async execute(input: AiTaskInput): Promise<unknown> {
    const scenario = this.options.scenario ?? 'normal';
    if (scenario === 'failure' || scenario === 'timeout')
      throw new AiAdapterError(String(failures[scenario]?.code));
    if (this.options.results && Object.hasOwn(this.options.results, input.kind))
      return structuredClone(this.options.results[input.kind]);
    if (
      scenario === 'normal' &&
      canonicalJson(input) === canonicalJson(AI_FIXTURES[input.kind].input)
    )
      return structuredClone(AI_FIXTURES[input.kind].output);
    const envelope = structuredClone(AI_FIXTURES[input.kind].output);
    let result: unknown = envelope.result;
    if (envelope.kind === 'EXTRACT_NEED' && input.kind === 'EXTRACT_NEED') {
      const need = envelope.result.proposedNeed;
      const seoulDay =
        Math.floor((Date.parse(input.serverNow) + 9 * 3_600_000) / 86_400_000) * 86_400_000;
      need.startAt = new Date(seoulDay + 2 * 86_400_000 + 3_600_000)
        .toISOString()
        .replace('.000Z', 'Z');
      need.endAt = new Date(seoulDay + 3 * 86_400_000 + 7 * 3_600_000)
        .toISOString()
        .replace('.000Z', 'Z');
      need.preferredPlaceIds = /아무\s*데나/u.test(input.context.text)
        ? input.context.places.map((p) => p.id)
        : input.context.draft.preferredPlaceIds;
      envelope.result.missingFields = need.preferredPlaceIds.length ? [] : ['preferredPlaceIds'];
      envelope.result.clarificationQuestion = need.preferredPlaceIds.length
        ? null
        : '어느 장소에서 물품을 받을까요?';
    }
    if (envelope.kind === 'EXPLAIN_TERMS' && input.kind === 'EXPLAIN_TERMS') {
      const mapping = {
        START_AT: 'startAt',
        END_AT: 'endAt',
        PLACE: 'placeId',
        TOTAL_FEE: 'totalFeeKrw',
      } as const;
      envelope.result.changedFields = (Object.keys(mapping) as ChangedField[]).filter(
        (k) => input.context.oldTerms[mapping[k]] !== input.context.newTerms[mapping[k]],
      );
      envelope.result.summary = `변경 제안: ${envelope.result.changedFields.join(', ') || '조건 변경 없음'}. 실제 승인 상태는 요청 카드에서 확인해 주세요.`;
    }
    if (envelope.kind === 'COMPARE_OFFERS' && input.kind === 'COMPARE_OFFERS') {
      envelope.result.rows = input.context.offers.map((offer) => ({
        negotiationId: offer.negotiationId,
        termsRevision: offer.termsRevision,
        explanation: `${offer.itemSummary.title}: ${offer.terms.totalFeeKrw.toLocaleString('ko-KR')}원, ${offer.terms.placeId} 제안입니다.`,
      }));
    }
    if (scenario === 'invalid-option' || scenario === 'unsupported-reason')
      result = failures[scenario];
    if (scenario === 'authority-injection') result = { ...envelope.result, ...failures[scenario] };
    if (scenario === 'unclear') result = failures[scenario];
    return { taskId: input.taskId, kind: input.kind, inputVersion: input.inputVersion, result };
  }
}
