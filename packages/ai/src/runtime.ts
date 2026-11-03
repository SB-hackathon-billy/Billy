import OpenAI from 'openai';

export class AiAdapterError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'AiAdapterError';
  }
}

export type AiEnvironment = Record<string, string | undefined>;
export interface AiConfig {
  mode: 'live' | 'fixture';
  apiKey?: string;
  agentModel: string;
  decisionModel: string;
  voiceModel: string;
  timeoutMs: number;
  decisionTimeoutMs: number;
}

export function positiveMs(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AiAdapterError('INVALID_CONFIG', `${name} must be positive integer milliseconds`);
  return value;
}

export function readAiConfig(env: AiEnvironment): AiConfig {
  const mode = env.AI_MODE ?? 'live';
  if (mode !== 'live' && mode !== 'fixture')
    throw new AiAdapterError('INVALID_CONFIG', 'AI_MODE must be live or fixture');
  if (mode === 'live' && !env.OPENAI_API_KEY) throw new AiAdapterError('API_KEY_REQUIRED');
  return {
    mode,
    ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
    agentModel: env.OPENAI_AGENT_MODEL ?? 'gpt-6.1-terra',
    decisionModel: env.OPENAI_DECISION_MODEL ?? 'gpt-6-luna',
    voiceModel: env.OPENAI_VOICE_MODEL ?? 'gpt-live-1',
    timeoutMs: positiveMs(Number(env.OPENAI_TIMEOUT_MS ?? 30_000), 'OPENAI_TIMEOUT_MS'),
    decisionTimeoutMs: positiveMs(
      Number(env.OPENAI_DECISION_TIMEOUT_MS ?? 8_000),
      'OPENAI_DECISION_TIMEOUT_MS',
    ),
  };
}

export function createOpenAIClient(config: AiConfig): OpenAI {
  if (!config.apiKey) throw new AiAdapterError('API_KEY_REQUIRED');
  return new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: config.timeoutMs });
}

export interface RetryRuntime {
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function isTransient(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return false;
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIError)
    return error.status === 429 || (error.status !== undefined && error.status >= 500);
  return false;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiAdapterError('TIMEOUT'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** Three total attempts; one deadline includes all calls and backoff. */
export async function withRetry<T>(
  operation: (signal: AbortSignal, remainingMs: number) => Promise<T>,
  timeoutMs: number,
  runtime: RetryRuntime = {},
): Promise<T> {
  positiveMs(timeoutMs, 'timeoutMs');
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiAdapterError('TIMEOUT'));
    }, timeoutMs);
  });
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (controller.signal.aborted || Date.now() >= deadline) throw new AiAdapterError('TIMEOUT');
      try {
        const result = await operation(
          controller.signal,
          Math.max(1, Math.trunc(deadline - Date.now())),
        );
        if (controller.signal.aborted || Date.now() >= deadline)
          throw new AiAdapterError('TIMEOUT');
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new AiAdapterError('TIMEOUT');
        if (!isTransient(error) || attempt === 2) throw error;
        const delay =
          (attempt === 0 ? 1_000 : 4_000) + Math.floor((runtime.random ?? Math.random)() * 251);
        await (runtime.sleep ?? sleep)(delay, controller.signal);
      }
    }
    throw new AiAdapterError('RETRY_EXHAUSTED');
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Safe diagnostics: never serialize provider exceptions (they can contain headers). */
export function errorSummary(error: unknown): { code: string; status?: number } {
  if (error instanceof AiAdapterError) return { code: error.code };
  if (error instanceof OpenAI.APIError)
    return {
      code: typeof error.code === 'string' ? error.code : error.name,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  return { code: error instanceof Error ? error.name : 'UNKNOWN_ERROR' };
}
