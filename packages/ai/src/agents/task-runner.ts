import type { AiTaskInput, AiTaskResult } from '@sb/contracts';
import type { AiTransport } from '../transport.js';
import { checkedInput } from '../validation.js';
import { TASK_AGENTS } from './definitions.js';

export interface AgentDiagnostic {
  roleId: AiTaskInput['kind'];
  promptVersion: string;
  taskId: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'FALLBACK';
  boundary: 'MODEL' | 'RESULT';
  durationMs: number;
}
export interface AgentRunOptions {
  /** Receives identifiers and fixed categories only, never input/output or provider errors. */
  onDiagnostic?: (event: AgentDiagnostic) => void;
}

/** One existing task invocation. No tools, autonomous loop, DB access or new retries. */
export async function runAgentTask(
  transport: AiTransport,
  input: AiTaskInput,
  options: AgentRunOptions = {},
): Promise<AiTaskResult | null> {
  // Bad inputs are programming errors; do not turn them into an AI fallback.
  const task = checkedInput(input);
  const role = TASK_AGENTS[task.kind];
  const started = Date.now();
  let boundary: AgentDiagnostic['boundary'] = 'MODEL';
  const report = (outcome: AgentDiagnostic['outcome']) => {
    try {
      options.onDiagnostic?.({
        roleId: role.id,
        promptVersion: role.promptVersion,
        taskId: task.taskId,
        outcome,
        boundary,
        durationMs: Math.max(0, Date.now() - started),
      });
    } catch {
      /* Diagnostics cannot change task results or fallbacks. */
    }
  };
  try {
    const raw = await transport.execute(task);
    boundary = 'RESULT';
    const result = role.resultGuard(task, raw);
    report('SUCCEEDED');
    return result;
  } catch (error) {
    if (role.failure === 'FEE_BASELINE') {
      report('FALLBACK');
      return null;
    }
    if (role.failure === 'UNCLEAR' && task.kind === 'ROUTE_INTENT') {
      report('FALLBACK');
      return {
        taskId: task.taskId,
        kind: 'ROUTE_INTENT',
        inputVersion: task.inputVersion,
        result: { intent: 'UNCLEAR' },
      };
    }
    report('FAILED');
    throw error;
  }
}
