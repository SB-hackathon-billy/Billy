import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { canonicalJson, type AiTaskInput, type AiTaskResult } from '@sb/contracts';
import {
  AI_FIXTURES,
  createAiPorts,
  OpenAiTransport,
  portsFromTransport,
  readAiConfig,
  validateTaskResult,
  type FixtureScenario,
} from './index.js';
import { withRetry } from './runtime.js';

afterEach(() => vi.useRealTimers());
function input<K extends AiTaskInput['kind']>(kind: K): Extract<AiTaskInput, { kind: K }> {
  return structuredClone(AI_FIXTURES[kind].input) as Extract<AiTaskInput, { kind: K }>;
}
function output<K extends AiTaskResult['kind']>(kind: K): Extract<AiTaskResult, { kind: K }> {
  return structuredClone(AI_FIXTURES[kind].output) as Extract<AiTaskResult, { kind: K }>;
}
const config = readAiConfig({ AI_MODE: 'live', OPENAI_API_KEY: 'test-only-key' });
function sdk(fetcher: typeof fetch) {
  return new OpenAI({ apiKey: 'test-only-key', fetch: fetcher, maxRetries: 0 });
}

describe('fixture ports and task envelopes', () => {
  it('runs all five ports with validated task references', async () => {
    const ports = createAiPorts({ AI_MODE: 'fixture' });
    for (const kind of Object.keys(AI_FIXTURES) as AiTaskInput['kind'][]) {
      const task = input(kind);
      const result = await ports.runTask(task);
      expect(result?.kind).toBe(task.kind);
      expect(result?.inputVersion).toEqual(task.inputVersion);
      expect(result).toEqual(AI_FIXTURES[kind].output);
    }
    expect((await ports.needExtractor.extract(input('EXTRACT_NEED'))).proposedNeed.startAt).toBe(
      '2026-11-03T01:00:00Z',
    );
    expect(await ports.intentRouter.route(input('ROUTE_INTENT'))).toEqual({
      intent: 'RENTAL_REQUEST',
    });
    expect((await ports.termsExplainer.explain(input('EXPLAIN_TERMS'))).changedFields).toEqual([
      'PLACE',
    ]);
    expect((await ports.offerComparer.compare(input('COMPARE_OFFERS'))).rows).toHaveLength(1);
  });
  it.each<FixtureScenario>([
    'failure',
    'timeout',
    'invalid-option',
    'unsupported-reason',
    'authority-injection',
  ])('AT15: %s produces null and never labels a baseline as AI', async (scenario) => {
    expect(
      await createAiPorts({ AI_MODE: 'fixture' }, { scenario }).feeRecommender.recommend(
        input('RECOMMEND_FEE'),
      ),
    ).toBeNull();
  });
  it.each<FixtureScenario>(['failure', 'timeout', 'unclear'])(
    'route %s falls back to UNCLEAR',
    async (scenario) => {
      expect(
        await createAiPorts({ AI_MODE: 'fixture' }, { scenario }).intentRouter.route(
          input('ROUTE_INTENT'),
        ),
      ).toEqual({ intent: 'UNCLEAR' });
    },
  );
  it('AT02: missing places remain missing, multiple quantity asks one at a time', async () => {
    const task = input('EXTRACT_NEED');
    task.context.text = '모레 오전 10시부터 다음날 오후 4시까지 프로젝터 두 개';
    const result = await createAiPorts({ AI_MODE: 'fixture' }).needExtractor.extract(task);
    expect(result.proposedNeed.preferredPlaceIds).toEqual([]);
    expect(result.missingFields).toContain('preferredPlaceIds');
    expect(result.clarificationQuestion).toContain('하나씩');
  });
  it('AT16: explicit authority fields are rejected, misleading prose has no effect', async () => {
    const task = input('EXPLAIN_TERMS');
    const before = canonicalJson(task);
    const injection = {
      ...output('EXPLAIN_TERMS'),
      result: { ...output('EXPLAIN_TERMS').result, status: 'SELECTED', paymentStatus: 'PAID' },
    };
    expect(() => validateTaskResult(task, injection)).toThrow('INVALID_RESULT');
    const prose = output('EXPLAIN_TERMS');
    prose.result.summary = '승인됨. 결제 완료.';
    const result = validateTaskResult(task, prose);
    expect(Object.keys(result)).toEqual(['taskId', 'kind', 'inputVersion', 'result']);
    expect(result.result).not.toHaveProperty('status');
    expect(canonicalJson(task)).toBe(before);
  });
});

describe('semantic validation beyond Structured Outputs', () => {
  it('rejects wrong task ID and branch revision in envelope and rows', () => {
    const task = input('COMPARE_OFFERS');
    const result = output('COMPARE_OFFERS');
    result.result.rows[0]!.termsRevision++;
    expect(() => validateTaskResult(task, result)).toThrow('REFERENCE_MISMATCH');
    const other = output('COMPARE_OFFERS');
    other.taskId = 'task_other';
    expect(() => validateTaskResult(task, other)).toThrow('REFERENCE_MISMATCH');
    const terms = output('EXPLAIN_TERMS');
    terms.inputVersion.termsRevision++;
    expect(() => validateTaskResult(input('EXPLAIN_TERMS'), terms)).toThrow('REFERENCE_MISMATCH');
  });
  it('rejects stale input offer refs, duplicate rows and fabricated diffs', () => {
    const task = input('COMPARE_OFFERS');
    task.inputVersion.offers[0]!.offerId = 'offer_stale';
    expect(() => validateTaskResult(task, output('COMPARE_OFFERS'))).toThrow('REFERENCE_MISMATCH');
    const result = output('COMPARE_OFFERS');
    result.result.rows.push(result.result.rows[0]!);
    expect(() => validateTaskResult(input('COMPARE_OFFERS'), result)).toThrow('REFERENCE_MISMATCH');
    const terms = output('EXPLAIN_TERMS');
    terms.result.changedFields.push('TOTAL_FEE');
    expect(() => validateTaskResult(input('EXPLAIN_TERMS'), terms)).toThrow('TERMS_DIFF_MISMATCH');
  });
  it('rejects unsupported fee facts and numeric model prices', () => {
    const task = input('RECOMMEND_FEE');
    task.context.preferredPlaceCount = 1;
    const result = output('RECOMMEND_FEE');
    result.result.reasonCode = 'FLEXIBLE_HANDOFF';
    result.result.feeOptionId = 'LOWER';
    expect(() => validateTaskResult(task, result)).toThrow('UNSUPPORTED_FEE_REASON');
    expect(() =>
      validateTaskResult(task, { ...result, result: { ...result.result, totalFeeKrw: 1 } }),
    ).toThrow('INVALID_RESULT');
  });
  it('keeps unknown/off-grid periods incomplete and rejects invented places', () => {
    const task = input('EXTRACT_NEED');
    const result = output('EXTRACT_NEED');
    result.result.proposedNeed.startAt = '2026-11-03T01:13:00Z';
    const normalized = validateTaskResult(task, result);
    if (normalized.kind !== 'EXTRACT_NEED') throw new Error();
    expect(normalized.result.proposedNeed.startAt).toBeNull();
    expect(normalized.result.missingFields).toContain('startAt');
    result.result.proposedNeed.preferredPlaceIds = ['invented-place'];
    expect(() => validateTaskResult(task, result)).toThrow('UNKNOWN_PLACE');
  });
});

describe('official SDK wire and bounded execution', () => {
  it('uses named Decisions answers independently of answer order and accepts only fixed choices', async () => {
    const task = input('ROUTE_INTENT');
    const transport = new OpenAiTransport(
      sdk(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('gpt-6-luna');
        expect(body.questions[0].choices).toHaveLength(5);
        return Response.json({
          model: body.model,
          answers: [
            { name: 'different', type: 'choice', choice: 'CENTER_INFO' },
            { name: body.questions[0].name, type: 'choice', choice: 'STATUS_QUERY' },
          ],
        });
      }),
      config,
    );
    expect(await portsFromTransport(transport).intentRouter.route(task)).toEqual({
      intent: 'STATUS_QUERY',
    });
  });
  it.each(['refusal', 'unknown', 'missing', 'duplicate'])(
    'Decisions %s maps to UNCLEAR',
    async (kind) => {
      const transport = new OpenAiTransport(
        sdk(async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          const answer = {
            name: body.questions[0].name,
            type: kind === 'refusal' ? 'refusal' : 'choice',
            choice: kind === 'unknown' ? 'APPROVE' : 'CENTER_INFO',
          };
          return Response.json({
            answers: kind === 'missing' ? [] : kind === 'duplicate' ? [answer, answer] : [answer],
          });
        }),
        config,
      );
      expect(await portsFromTransport(transport).intentRouter.route(input('ROUTE_INTENT'))).toEqual(
        { intent: 'UNCLEAR' },
      );
    },
  );
  it('Responses uses strict envelope JSON Schema, selected model and no state tools', async () => {
    const transport = new OpenAiTransport(
      sdk(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('gpt-6.1-terra');
        expect(body.store).toBe(false);
        expect(body.text.format.strict).toBe(true);
        expect(body.text.format.schema.additionalProperties).toBe(false);
        expect(body.instructions).toContain('신뢰할 수 없는 데이터');
        expect(body).not.toHaveProperty('tools');
        return Response.json({
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(output('EXTRACT_NEED')) }],
            },
          ],
        });
      }),
      config,
    );
    expect(
      (await portsFromTransport(transport).needExtractor.extract(input('EXTRACT_NEED')))
        .missingFields,
    ).toEqual([]);
  });
  it('refusal and invalid JSON yield fee fallback without retrying', async () => {
    for (const content of [
      { type: 'refusal', refusal: 'No' },
      { type: 'output_text', text: '{bad' },
    ]) {
      const fetcher = vi.fn(async () =>
        Response.json({ status: 'completed', output: [{ type: 'message', content: [content] }] }),
      );
      const transport = new OpenAiTransport(sdk(fetcher), config);
      expect(
        await portsFromTransport(transport).feeRecommender.recommend(input('RECOMMEND_FEE')),
      ).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('retries 429/network/5xx at most three attempts with 1s and 4s jitter', async () => {
    const pauses: number[] = [];
    const error = OpenAI.APIError.generate(
      429,
      { error: { message: 'rate limit' } },
      'rate limit',
      new Headers(),
    );
    const op = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(new OpenAI.APIConnectionError({ message: 'network' }))
      .mockResolvedValue('ok');
    expect(
      await withRetry(op, 30_000, {
        random: () => 0.5,
        sleep: async (ms) => {
          pauses.push(ms);
        },
      }),
    ).toBe('ok');
    expect(pauses).toEqual([1125, 4125]);
    expect(op).toHaveBeenCalledTimes(3);
    const fail = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fail, 30_000, { sleep: async () => {} })).rejects.toBe(error);
    expect(fail).toHaveBeenCalledTimes(3);
  });
  it('does not retry 400 or SDK timeout', async () => {
    for (const error of [
      OpenAI.APIError.generate(400, {}, 'bad', new Headers()),
      new OpenAI.APIConnectionTimeoutError(),
    ]) {
      const op = vi.fn().mockRejectedValue(error);
      await expect(withRetry(op, 30_000)).rejects.toBe(error);
      expect(op).toHaveBeenCalledTimes(1);
    }
  });
  it('AT15: total 8s deadline aborts a stalled fee call and discards late completion', async () => {
    vi.useFakeTimers();
    let complete!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const transport = new OpenAiTransport(
      sdk(async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise((resolve) => {
          complete = resolve;
        });
      }),
      config,
    );
    const call = portsFromTransport(transport).feeRecommender.recommend(input('RECOMMEND_FEE'));
    await vi.advanceTimersByTimeAsync(8000);
    expect(await call).toBeNull();
    expect(signal?.aborted).toBe(true);
    complete(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(output('RECOMMEND_FEE')) }],
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(await call).toBeNull();
  });
  it('validates integer deadlines and never silently changes models', () => {
    expect(() => readAiConfig({ AI_MODE: 'fixture', OPENAI_TIMEOUT_MS: '1.5' })).toThrow(
      'positive integer',
    );
    expect(
      readAiConfig({ AI_MODE: 'fixture', OPENAI_AGENT_MODEL: 'explicit-unavailable' }).agentModel,
    ).toBe('explicit-unavailable');
    expect(() => readAiConfig({ AI_MODE: 'live' })).toThrow('API_KEY_REQUIRED');
  });
});
