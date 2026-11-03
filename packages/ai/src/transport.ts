import OpenAI from 'openai';
import { z } from 'zod';
import { TASK_INPUT_VERSION_SCHEMAS, INTENT_VALUES, type AiTaskInput } from '@sb/contracts';
import { AiAdapterError, withRetry, type AiConfig, type RetryRuntime } from './runtime.js';
import { taskInstructions } from './prompts.js';
import { TASK_AGENTS } from './agents/definitions.js';

export interface AiTransport {
  execute(input: AiTaskInput): Promise<unknown>;
}

export function taskResultJsonSchema(input: AiTaskInput): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      taskId: { type: 'string' },
      kind: { type: 'string', enum: [input.kind] },
      inputVersion: z.toJSONSchema(TASK_INPUT_VERSION_SCHEMAS[input.kind]),
      result: TASK_AGENTS[input.kind].outputSchema,
    },
    required: ['taskId', 'kind', 'inputVersion', 'result'],
  };
}

const descriptions = {
  RENTAL_REQUEST: '물품을 빌리려는 새 요청',
  CHANGE_CONDITIONS: '기존 기간·장소·조건 정정',
  STATUS_QUERY: '현재 요청이나 제안 상태 확인',
  CENTER_INFO: '센터 소개·프로그램·공지 안내',
  UNCLEAR: '모호하거나 지원 범위 밖인 요청',
};

export class OpenAiTransport implements AiTransport {
  constructor(
    private readonly client: OpenAI,
    private readonly config: AiConfig,
    private readonly runtime: RetryRuntime = {},
  ) {}

  async execute(input: AiTaskInput): Promise<unknown> {
    const role = TASK_AGENTS[input.kind];
    const timeoutMs = role.timeout(this.config);
    return withRetry(
      async (signal, remainingMs) => {
        if (input.kind === 'ROUTE_INTENT') {
          const name = `route_${input.taskId}_${input.inputVersion.turnId}`;
          const decision = await this.client.decisions.create(
            {
              model: this.config[role.modelKey],
              input: [
                {
                  role: 'developer',
                  content: [{ type: 'input_text', text: taskInstructions(input) }],
                },
                { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] },
              ],
              questions: [
                {
                  type: 'choice',
                  name,
                  instructions: '사용자의 현재 의도 하나를 선택한다. 알 수 없으면 UNCLEAR.',
                  choices: INTENT_VALUES.map((value) => ({
                    value,
                    description: descriptions[value],
                  })),
                },
              ],
            },
            { signal, timeout: remainingMs, maxRetries: 0 },
          );
          const answers = decision.answers.filter((a) => a.name === name);
          const answer = answers.length === 1 ? answers[0] : undefined;
          const intent =
            answer?.type === 'choice' && INTENT_VALUES.some((v) => v === answer.choice)
              ? answer.choice
              : 'UNCLEAR';
          return {
            taskId: input.taskId,
            kind: input.kind,
            inputVersion: input.inputVersion,
            result: { intent },
          };
        }
        const response = await this.client.responses.create(
          {
            model: this.config[role.modelKey],
            store: false,
            instructions: taskInstructions(input),
            input: JSON.stringify(input),
            text: {
              format: {
                type: 'json_schema',
                name: `sb_${input.kind.toLowerCase()}`,
                strict: true,
                schema: taskResultJsonSchema(input),
              },
            },
          },
          { signal, timeout: remainingMs, maxRetries: 0 },
        );
        if (
          response.status !== 'completed' ||
          response.output.some(
            (item) =>
              item.type === 'message' && item.content.some((content) => content.type === 'refusal'),
          )
        )
          throw new AiAdapterError('MODEL_REFUSAL_OR_INCOMPLETE');
        try {
          return JSON.parse(response.output_text) as unknown;
        } catch {
          throw new AiAdapterError('INVALID_JSON');
        }
      },
      timeoutMs,
      this.runtime,
    );
  }
}
