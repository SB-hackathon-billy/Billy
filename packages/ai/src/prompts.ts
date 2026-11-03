import type { AiTaskInput } from '@sb/contracts';
import { TASK_AGENTS } from './agents/definitions.js';
import { AUTHORITY_RULES } from './agents/instructions.js';
export { AUTHORITY_RULES } from './agents/instructions.js';

export function taskInstructions(input: AiTaskInput): string {
  return `${AUTHORITY_RULES}\n${TASK_AGENTS[input.kind].instructions}\n출력 스키마 밖 필드는 금지한다. 입력의 taskId, kind, inputVersion을 그대로 복사하고 result에만 결과를 담는다. 서버 기준 시각=${input.serverNow}, 시간대=Asia/Seoul, 서울 오늘=${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short' }).format(new Date(input.serverNow))}.`;
}
