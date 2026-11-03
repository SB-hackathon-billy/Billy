import type {
  AiTaskInput,
  AiTaskResult,
  FeeRecommender,
  NeedExtractor,
  IntentRouter,
  TermsExplainer,
  OfferComparer,
} from '@sb/contracts';
import { runAgentTask, type AgentRunOptions } from './agents/task-runner.js';
import { AiAdapterError, createOpenAIClient, readAiConfig, type AiEnvironment } from './runtime.js';
import { OpenAiTransport, type AiTransport } from './transport.js';
import { FixtureTransport, type FixtureOptions } from './fixtures.js';

export interface AiPorts {
  feeRecommender: FeeRecommender;
  needExtractor: NeedExtractor;
  intentRouter: IntentRouter;
  termsExplainer: TermsExplainer;
  offerComparer: OfferComparer;
  runTask(input: AiTaskInput): Promise<AiTaskResult | null>;
}

export function portsFromTransport(transport: AiTransport, options: AgentRunOptions = {}): AiPorts {
  const runTask = (input: AiTaskInput) => runAgentTask(transport, input, options);
  return {
    runTask,
    feeRecommender: {
      recommend: async (input) => {
        const out = await runTask(input);
        if (out === null) return null;
        if (out.kind !== 'RECOMMEND_FEE') throw new AiAdapterError('KIND_MISMATCH');
        return out.result;
      },
    },
    needExtractor: {
      extract: async (input) => {
        const out = await runTask(input);
        if (out?.kind !== 'EXTRACT_NEED') throw new AiAdapterError('KIND_MISMATCH');
        return out.result;
      },
    },
    intentRouter: {
      route: async (input) => {
        const out = await runTask(input);
        if (out?.kind !== 'ROUTE_INTENT') throw new AiAdapterError('KIND_MISMATCH');
        return out.result;
      },
    },
    termsExplainer: {
      explain: async (input) => {
        const out = await runTask(input);
        if (out?.kind !== 'EXPLAIN_TERMS') throw new AiAdapterError('KIND_MISMATCH');
        return out.result;
      },
    },
    offerComparer: {
      compare: async (input) => {
        const out = await runTask(input);
        if (out?.kind !== 'COMPARE_OFFERS') throw new AiAdapterError('KIND_MISMATCH');
        return out.result;
      },
    },
  };
}

export function createAiPorts(
  env: AiEnvironment = process.env,
  fixtureOptions: FixtureOptions = {},
  options: AgentRunOptions = {},
): AiPorts {
  const config = readAiConfig(env);
  const transport =
    config.mode === 'fixture'
      ? new FixtureTransport(fixtureOptions)
      : new OpenAiTransport(createOpenAIClient(config), config);
  return portsFromTransport(transport, options);
}
