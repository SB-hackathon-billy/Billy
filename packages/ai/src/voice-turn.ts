import type OpenAI from 'openai';
import { createOpenAIClient, readAiConfig, type AiEnvironment } from './runtime.js';
import { AUTHORITY_RULES, TURN_RULES } from './agents/instructions.js';
import { TURN_AGENT } from './agents/definitions.js';

export type VoiceTurnDecision = { complete: boolean; scope: 'ALLOWED' | 'OUT_OF_SCOPE' | 'UNSAFE' };
export function createVoiceTurnChecker(env: AiEnvironment = process.env, client?: OpenAI) {
  const config = readAiConfig(env);
  const api = client ?? createOpenAIClient(config);
  return async (text: string, ended = false): Promise<VoiceTurnDecision> => {
    // Failure is never permission to interrupt or run a task. No alternate model.
    const response = await api.decisions.create(
      {
        model: config[TURN_AGENT.modelKey],
        input: [
          {
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: `${AUTHORITY_RULES}\n${TURN_AGENT.instructions} 통화 종료 버튼=${ended}.`,
              },
            ],
          },
          { role: 'user', content: [{ type: 'input_text', text }] },
        ],
        questions: [
          {
            type: 'choice',
            name: 'turn',
            instructions: TURN_RULES.turn,
            choices: [{ value: 'COMPLETE' }, { value: 'WAIT' }],
          },
          {
            type: 'choice',
            name: 'scope',
            instructions: TURN_RULES.scope,
            choices: [{ value: 'ALLOWED' }, { value: 'OUT_OF_SCOPE' }, { value: 'UNSAFE' }],
          },
        ],
      },
      { timeout: TURN_AGENT.timeout(config), maxRetries: TURN_AGENT.maxRetries },
    );
    const answer = (name: string) => {
      const values = response.answers.filter((value) => value.name === name);
      return values.length === 1 && values[0]?.type === 'choice' ? values[0].choice : null;
    };
    const scope = answer('scope');
    return {
      complete: answer('turn') === 'COMPLETE',
      scope: scope === 'ALLOWED' || scope === 'OUT_OF_SCOPE' ? scope : 'UNSAFE',
    };
  };
}
