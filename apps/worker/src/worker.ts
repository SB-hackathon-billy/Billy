import { setTimeout as delay } from 'node:timers/promises';
import { PgBoss, type Job } from 'pg-boss';
import { AiAdapterError, createAiPorts, validateTaskResult, type AiPorts } from '@sb/ai';
import { AgentTaskSchema, type AgentTask } from '@sb/contracts';
import { Database, DomainError, sweepReservations } from '@sb/db';

export const TASK_QUEUE = 'sb-agent-tasks';
type TaskJob = { taskId: string };
export type WorkerLog = (event: string, fields: Record<string, string | number | boolean>) => void;
export interface WorkerOptions {
  db: Database;
  ai?: AiPorts;
  dispatchIntervalMs?: number;
  recoveryIntervalMs?: number;
  expiryIntervalMs?: number;
  concurrency?: number;
  log?: WorkerLog;
}

const transientCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/** Only fixed categories enter queue output/logs; provider messages may contain secrets. */
export function classifyError(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof DomainError)
    return { code: error.code, retryable: error.status === 429 || error.status >= 500 };
  if (error instanceof AiAdapterError) return { code: 'AI_TASK_FAILED', retryable: false };
  const value = error as { code?: unknown; status?: unknown; name?: unknown } | null;
  const status = typeof value?.status === 'number' ? value.status : 0;
  const code = typeof value?.code === 'string' ? value.code : '';
  if (transientCodes.has(code) || code.startsWith('08'))
    return { code: 'TRANSIENT_IO_ERROR', retryable: true };
  if (status === 429 || status >= 500 || value?.name === 'APIConnectionError')
    return { code: 'TRANSIENT_PROVIDER_ERROR', retryable: true };
  return { code: 'WORKER_TASK_FAILED', retryable: false };
}

function interval(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

export class RentalWorker {
  readonly boss: PgBoss;
  private readonly ai: AiPorts;
  private readonly log: WorkerLog;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly loops = new Map<string, Promise<unknown>>();
  private startPromise: Promise<this> | undefined;
  private stopping = false;
  private stopPromise: Promise<void> | undefined;

  constructor(private readonly options: WorkerOptions) {
    this.log = options.log ?? (() => {});
    this.ai =
      options.ai ??
      createAiPorts(
        process.env,
        {},
        {
          onDiagnostic: (event) => this.log('agent.run', { ...event }),
        },
      );
    this.boss = new PgBoss({
      db: { executeSql: (text, values) => options.db.pool.query(text, values) },
      schema: 'pgboss',
      maintenanceIntervalSeconds: 5,
      superviseIntervalSeconds: 5,
      monitorIntervalSeconds: 5,
    });
    this.boss.on('error', (error) => this.log('queue.error', classifyError(error)));
  }

  start(): Promise<this> {
    if (this.startPromise || this.stopping)
      return Promise.reject(new Error('Worker already started or stopped'));
    this.startPromise = this.launch();
    return this.startPromise;
  }

  private async launch(): Promise<this> {
    const dispatchMs = interval(this.options.dispatchIntervalMs ?? 250, 'dispatchIntervalMs');
    const recoveryMs = interval(this.options.recoveryIntervalMs ?? 5_000, 'recoveryIntervalMs');
    // A one-second sweep also meets the expiry-fast demo's two-second visibility target.
    const expiryMs = interval(this.options.expiryIntervalMs ?? 1_000, 'expiryIntervalMs');
    const concurrency = interval(this.options.concurrency ?? 4, 'concurrency');
    try {
      await this.boss.start();
      await this.boss.createQueue(TASK_QUEUE, {
        policy: 'exclusive',
        retryLimit: 3,
        retryDelay: 0,
        retryBackoff: false,
        expireInSeconds: 120,
        heartbeatSeconds: 10,
        retentionSeconds: 86_400,
        deleteAfterSeconds: 86_400,
      });
      await this.options.db.expireDue();
      await this.dispatchOutbox();
      await this.recoverTasks();
      await this.boss.work<TaskJob>(
        TASK_QUEUE,
        {
          localConcurrency: concurrency,
          batchSize: 1,
          pollingIntervalSeconds: 0.5,
          heartbeatRefreshSeconds: 4,
        },
        async (jobs) => {
          for (const job of jobs) {
            try {
              await this.handle(job);
            } catch (error) {
              // pg-boss serializes thrown errors into its durable job output.
              throw new Error(classifyError(error).code);
            }
          }
        },
      );
      this.schedule('outbox', dispatchMs, () => this.dispatchOutbox());
      this.schedule('recovery', recoveryMs, () => this.recoverTasks());
      this.schedule('expiry', expiryMs, () => this.options.db.expireDue());
      // 3번(명세 0004): 응답 기한 만료·공공 모의 응답·대기 우선권. 시작 경로와 1번 작업에서 분리해
      // 실패해도 `reservations.error`로만 기록되고 다른 주기 작업과 큐 처리는 계속된다.
      this.schedule('reservations', expiryMs, () => sweepReservations(this.options.db));
      this.log('worker.started', { concurrency, expiryIntervalMs: expiryMs });
      return this;
    } catch (error) {
      await this.boss.stop({ graceful: true });
      throw error;
    }
  }

  private schedule(name: string, ms: number, fn: () => Promise<unknown>): void {
    this.timers.push(
      setInterval(() => {
        if (this.stopping || this.loops.has(name)) return;
        const run = fn()
          .catch((error: unknown) => {
            this.log(`${name}.error`, classifyError(error));
          })
          .finally(() => this.loops.delete(name));
        this.loops.set(name, run);
      }, ms),
    );
  }

  /** A queue send commits before marking delivery. Replaying either side is safe. */
  async dispatchOutbox(): Promise<number> {
    const rows = await this.options.db.pendingOutbox(100);
    for (const row of rows) {
      if (row.kind === 'TASK') {
        if (!row.payload.taskId) throw new Error('Invalid task outbox');
        await this.enqueue(row.payload.taskId);
      } else if (row.kind !== 'EVENT') throw new Error('Unknown outbox kind');
      // EVENT is already persisted and NOTIFY-ed by the domain transaction.
      await this.options.db.markOutboxDelivered(row.id);
    }
    return rows.length;
  }

  private async enqueue(taskId: string): Promise<void> {
    await this.boss.send(TASK_QUEUE, { taskId }, { singletonKey: taskId });
  }

  /** Read-only scan; all task/business mutations remain inside @sb/db commands. */
  async recoverTasks(): Promise<number> {
    let after = '';
    let count = 0;
    for (;;) {
      const { rows } = await this.options.db.pool.query<{ id: string }>(
        "SELECT id FROM agent_tasks WHERE data->>'status' IN ('QUEUED','RUNNING') AND id>$1 ORDER BY id LIMIT 100",
        [after],
      );
      for (const row of rows) await this.enqueue(row.id);
      count += rows.length;
      if (rows.length < 100 || this.stopping) return count;
      after = rows.at(-1)!.id;
    }
  }

  private async handle(job: Job<TaskJob>): Promise<void> {
    // startTask locks and checks root/input references, and bounds attempts at three.
    const task = await this.options.db.startTask(job.data.taskId);
    if (!task) return;
    this.log('task.started', { taskId: task.id, kind: task.kind, attempt: task.attempt });
    try {
      await this.execute(AgentTaskSchema.parse(task));
      const final = await this.options.db.getTask(task.id);
      this.log('task.finished', { taskId: task.id, kind: task.kind, status: final.status });
    } catch (error) {
      const failure = classifyError(error);
      // AI transports already perform their bounded provider retries within one deadline.
      const retry =
        failure.retryable &&
        task.attempt < 3 &&
        (task.kind === 'SEARCH' || task.kind === 'PUBLIC_SUBMIT');
      await this.options.db.failTask(task.id, failure.code, !retry);
      this.log('task.failed', { taskId: task.id, kind: task.kind, code: failure.code, retry });
      if (retry) {
        // Keep the exclusive job lease (and heartbeat) during backoff. pg-boss update()
        // only edits pending jobs, so changing retryDelay on an active job is ineffective.
        await delay((task.attempt === 1 ? 1_000 : 4_000) + Math.floor(Math.random() * 251));
        throw new Error(failure.code);
      }
    }
  }

  private async execute(task: AgentTask): Promise<void> {
    if (!task.requestId) throw new Error('Task request missing');
    if (task.kind === 'SEARCH') {
      await this.options.db.runSearch(task.requestId, task.inputVersion, {
        feeRecommender: this.ai.feeRecommender,
      });
    } else if (task.kind === 'PUBLIC_SUBMIT') {
      await delay(1_000 + Math.floor(Math.random() * 1_001));
      await this.options.db.applyPublicDecision(task.id, task.inputVersion);
    } else {
      const input = await this.options.db.getTaskInput(task.id);
      if (!input) throw new Error('Task input missing');
      const raw = await this.ai.runTask(input);
      if (raw === null) {
        await this.options.db.failTask(task.id, 'FEE_BASELINE_FALLBACK', true);
        return;
      }
      const output = validateTaskResult(input, raw);
      if (!output) throw new Error('Task result missing');
      // The command rechecks input refs and root state in the same transaction as the effect.
      await this.options.db.recordTaskResult(task.id, task.inputVersion, output.result);
    }
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.shutdown();
    return this.stopPromise;
  }

  private async shutdown(): Promise<void> {
    this.stopping = true;
    // A signal can arrive while migrations/queue registration are still in flight.
    await this.startPromise?.catch(() => {});
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.loops.values()]);
    await this.boss.stop({ graceful: true, timeout: 60_000 });
    this.log('worker.stopped', {});
  }
}
