// 3번 거점 반납: 대여 전·반납 사진을 비교해 달라진 부분 후보를 고른다. 명세: docs/specs/0007-hub-handover-return.md
// AI는 판정하지 않는다. 최종 판정은 거점 관리자가 한다. 접수(1번) 역할·프롬프트와 분리된 경로다.
import { z } from 'zod';
import type { ReturnComparison } from '@sb/contracts';
import { AiAdapterError, createOpenAIClient, readAiConfig, type AiEnvironment } from './runtime.js';
import type { ListingPhoto } from './registration.js';

export type ReturnInspector = (
  before: ListingPhoto,
  after: ListingPhoto,
) => Promise<ReturnComparison>;

const INSTRUCTIONS = `너는 이웃 간 물품 대여 거점의 반납 확인 도우미다.
첫 번째 사진은 빌려주기 전, 두 번째 사진은 반납할 때 찍은 같은 물건이다.
- differences: 두 사진에서 눈에 보이게 달라진 부분 후보(긁힘, 파손, 오염, 빠진 구성품 등). 각 40자 이내 한국어, 최대 5개. 촬영 각도·조명 차이는 제외한다. 없으면 빈 배열.
- summary: 한 문장(60자 이내) 요약. 달라진 부분이 없으면 "눈에 띄게 달라진 부분이 없어요."
파손 여부를 판정하거나 책임을 단정하지 않는다. 후보만 알린다.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'differences'],
  properties: {
    summary: { type: 'string' },
    differences: { type: 'array', items: { type: 'string' } },
  },
} as const;
const Output = z.object({ summary: z.string(), differences: z.array(z.string()) }).strict();

export const RETURN_COMPARISON_FIXTURE: ReturnComparison = {
  status: 'DONE',
  summary: '한 곳이 달라 보여요. 관리자가 직접 확인해 주세요.',
  differences: ['손잡이 아래쪽에 긁힘으로 보이는 자국'],
};

export function createReturnInspector(env: AiEnvironment = process.env): ReturnInspector {
  const config = readAiConfig(env);
  if (config.mode === 'fixture') return async () => RETURN_COMPARISON_FIXTURE;
  const client = createOpenAIClient(config);
  const model = env.OPENAI_VISION_MODEL ?? config.agentModel;
  const image = (p: ListingPhoto) => ({
    type: 'input_image' as const,
    detail: 'auto' as const,
    image_url: `data:${p.contentType};base64,${p.bytes.toString('base64')}`,
  });
  return async (before, after) => {
    const response = await client.responses.create({
      model,
      store: false,
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: [image(before), image(after)] }],
      text: {
        format: { type: 'json_schema', name: 'return_comparison', strict: true, schema: SCHEMA },
      },
    });
    if (response.status !== 'completed') throw new AiAdapterError('MODEL_REFUSAL_OR_INCOMPLETE');
    const out = Output.safeParse(JSON.parse(response.output_text));
    if (!out.success) throw new AiAdapterError('INVALID_OUTPUT');
    return {
      status: 'DONE',
      summary: out.data.summary.slice(0, 200) || null,
      differences: out.data.differences
        .map((d) => d.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 5),
    };
  };
}
