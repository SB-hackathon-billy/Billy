import { AI_RESULT_JSON_SCHEMAS, type AiTaskInput } from '@sb/contracts';
import { type AiConfig } from '../runtime.js';
import { validateTaskResult } from '../validation.js';
import { TASK_RULES, VOICE_RULES, TURN_RULES } from './instructions.js';

type TaskKind = AiTaskInput['kind'];
type ModelKey = 'agentModel' | 'decisionModel' | 'voiceModel';
type FailurePolicy = 'THROW' | 'FEE_BASELINE' | 'UNCLEAR';

/** Internal role definitions; they never grant authority to mutate business records. */
export const FORBIDDEN_AGENT_EFFECTS = Object.freeze([
  'OWNER_RESPONSE',
  'SUBMIT_REQUEST',
  'SELECT_OFFER',
  'PAYMENT',
  'RESERVATION',
  'DIRECT_SQL',
  'ARBITRARY_URL',
] as const);

function taskRole<K extends TaskKind>(
  kind: K,
  purpose: string,
  options: {
    modelKey?: ModelKey;
    failure?: FailurePolicy;
    timeoutMs?: number;
  },
) {
  return Object.freeze({
    id: kind,
    purpose,
    promptVersion: `${kind.toLowerCase()}/1`,
    instructions: TASK_RULES[kind],
    modelKey: options.modelKey ?? 'agentModel',
    outputSchema: AI_RESULT_JSON_SCHEMAS[kind],
    resultGuard: validateTaskResult,
    failure: options.failure ?? 'THROW',
    timeout: (config: AiConfig) =>
      options.timeoutMs ?? (kind === 'ROUTE_INTENT' ? config.decisionTimeoutMs : config.timeoutMs),
    // Fixed tasks have one logical model step; transport retries share its deadline.
    maxSteps: 1,
    tools: Object.freeze([]),
    forbiddenEffects: FORBIDDEN_AGENT_EFFECTS,
  });
}

export const TASK_AGENTS = Object.freeze({
  ROUTE_INTENT: taskRole('ROUTE_INTENT', '현재 발화를 허용된 의도 힌트 하나로 분류한다.', {
    modelKey: 'decisionModel',
    failure: 'UNCLEAR',
  }),
  EXTRACT_NEED: taskRole('EXTRACT_NEED', '최신 발화를 검증 가능한 신청서 제안으로 추출한다.', {}),
  RECOMMEND_FEE: taskRole('RECOMMEND_FEE', '서버가 계산한 가격 옵션 중 하나를 추천한다.', {
    timeoutMs: 8_000,
    failure: 'FEE_BASELINE',
  }),
  EXPLAIN_TERMS: taskRole('EXPLAIN_TERMS', '서버가 제공한 실제 조건 변경만 설명한다.', {}),
  COMPARE_OFFERS: taskRole('COMPARE_OFFERS', '최신 제안을 입력 순서대로 설명한다.', {}),
});

export const VOICE_LIMITS = Object.freeze({
  maxDurationMs: 600_000,
  idleMs: 60_000,
  closeMs: 15_000,
  startupMs: 15_000,
  appendMs: 8_000,
});

/** Server capabilities, not Live function tools. No executable handler lives in @sb/ai. */
export const VOICE_CAPABILITIES = Object.freeze([
  Object.freeze({ name: 'read_request', description: '현재 요청의 서버 상태를 읽습니다.' }),
  Object.freeze({
    name: 'propose_request_summary',
    description: '사용자가 확인할 조건 요약을 제안합니다.',
  }),
]);

export const VOICE_AGENT = Object.freeze({
  id: 'VOICE_INTAKE',
  purpose: '대여 신청서 수집을 돕고 서버가 확인한 사실만 대화로 전달한다.',
  promptVersion: 'voice-intake/1',
  modelKey: 'voiceModel' as const,
  instructions: VOICE_RULES.conversation,
  requestInstructions: VOICE_RULES.request,
  backendCapabilities: VOICE_CAPABILITIES,
  limits: VOICE_LIMITS,
  forbiddenEffects: FORBIDDEN_AGENT_EFFECTS,
});

export const TURN_AGENT = Object.freeze({
  id: 'VOICE_TURN_GATE',
  purpose: '발화 완료·허용 범위를 판정하며 실행 권한은 부여하지 않는다.',
  promptVersion: 'voice-turn/1',
  modelKey: 'decisionModel' as const,
  instructions: TURN_RULES.input,
  maxSteps: 1,
  maxRetries: 0,
  timeout: (config: AiConfig) => Math.min(config.decisionTimeoutMs, 3_000),
  tools: Object.freeze([]),
  failure: 'CLOSED' as const,
  forbiddenEffects: FORBIDDEN_AGENT_EFFECTS,
});
