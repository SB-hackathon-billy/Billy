import type { Pool } from 'pg';
import {
  canonicalHash,
  ConfirmedNeedSchema,
  AI_RESULT_SCHEMAS,
  AgentTaskSchema,
  formatKrw,
  validatePeriod,
  matchesItem,
  type AgentTask,
  type AgentTaskDetail,
  type AiResult,
  type InputVersion,
  type FeeRecommender,
  type RentalRequest,
  type Negotiation,
  type Item,
  type Candidate,
  type SyncData,
  type AgentTaskKind,
  type AiTaskInput,
  type OwnerResponseBody,
  type Terms,
} from '@sb/contracts';
import { Commands } from './commands.js';
import { changedFields, type Session } from './unit.js';
import { createPool, read, all, put, fail, id, DomainError } from './storage.js';
import { quoteFor } from './pricing.js';
export type DatabaseOptions = {
  pool?: Pool;
  connectionString?: string;
  now?: () => Date;
  feeRecommender?: FeeRecommender;
};
export type StoredResponse = { status: number; body: unknown };
export type Idempotency = {
  session: Session;
  method: string;
  path: string;
  key: string;
  body: unknown;
};
export class Database {
  readonly pool: Pool;
  readonly now: () => Date;
  readonly feeRecommender: FeeRecommender | undefined;
  constructor(options: DatabaseOptions = {}) {
    this.pool = options.pool ?? createPool(options.connectionString);
    this.now = options.now ?? (() => new Date());
    this.feeRecommender = options.feeRecommender;
  }
  async close() {
    await this.pool.end();
  }
  async transaction<T>(fn: (u: Commands) => Promise<T>, now?: Date): Promise<T> {
    const c = await this.pool.connect();
    const u = new Commands(c, new Date(now ?? this.now()), now ? () => now : this.now);
    try {
      await c.query('BEGIN');
      const result = await fn(u);
      await u.flush();
      await c.query('COMMIT');
      return result;
    } catch (e) {
      if (e instanceof DomainError && e.commit) {
        try {
          await u.flush();
          await c.query('COMMIT');
        } catch (err) {
          await c.query('ROLLBACK');
          throw err;
        }
      } else await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async authorize(u: Commands, actor: string, path: string, body: unknown) {
    const requestId = /\/requests\/([^/]+)/.exec(path)?.[1];
    const negotiationId = /\/negotiations\/([^/]+)/.exec(path)?.[1];
    if (requestId) {
      const r = await read<RentalRequest>(u.c, 'rental_requests', requestId);
      if (!r || r.requesterId !== actor) fail('NOT_FOUND');
    }
    if (negotiationId) {
      const n = await read<Negotiation>(u.c, 'negotiations', negotiationId);
      if (!n) fail('NOT_FOUND');
      const r = await read<RentalRequest>(u.c, 'rental_requests', n.requestId);
      if (
        path.endsWith('/owner-response')
          ? n.ownerId !== actor
          : path.endsWith('/requester-counter')
            ? r?.requesterId !== actor
            : n.ownerId !== actor && r?.requesterId !== actor
      )
        fail('NOT_FOUND');
    }
    if (path.endsWith('/price-quotes')) {
      const b = body as { requestId?: string; negotiationId?: string; itemId?: string };
      const r = b.requestId ? await read<RentalRequest>(u.c, 'rental_requests', b.requestId) : null;
      if (!r) fail('NOT_FOUND');
      if (b.negotiationId) {
        const n = await read<Negotiation>(u.c, 'negotiations', b.negotiationId);
        if (
          !n ||
          n.requestId !== r.id ||
          n.itemId !== b.itemId ||
          (n.ownerId !== actor && r.requesterId !== actor)
        )
          fail('NOT_FOUND');
      } else if (r.requesterId !== actor) fail('NOT_FOUND');
    }
    if (path.endsWith('/agent-turns') || path.endsWith('/voice-sessions')) {
      const requestId = (body as { requestId?: string })?.requestId;
      const r = requestId ? await read<RentalRequest>(u.c, 'rental_requests', requestId) : null;
      if (!r || r.requesterId !== actor) fail('NOT_FOUND');
    }
  }
  async idempotent(
    input: Idempotency,
    fn: (u: Commands) => Promise<StoredResponse>,
  ): Promise<StoredResponse> {
    return this.transaction(async (u) => {
      const { session: s, method, path, key, body } = input;
      // Lock only this session/key before domain locks; identical retries serialize across connections.
      await u.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([s.id, method, path, key]),
      ]);
      const session = (
        await u.c.query(
          'SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>$3',
          [s.id, s.userId, u.iso],
        )
      ).rowCount;
      if (!session) fail('SESSION_EXPIRED');
      await this.authorize(u, s.userId, path, body);
      const bodyHash = canonicalHash(body ?? null);
      const args = [s.id, method, path, key];
      const existing = (
        await u.c.query(
          'SELECT * FROM idempotency_records WHERE session_id=$1 AND method=$2 AND path=$3 AND key=$4 AND expires_at>$5',
          [...args, u.iso],
        )
      ).rows[0];
      if (existing) {
        if (existing.actor_user_id !== s.userId) fail('NOT_FOUND');
        if (existing.body_hash !== bodyHash) fail('IDEMPOTENCY_KEY_REUSED');
        return existing.response as StoredResponse;
      }
      const result = await fn(u);
      const stored = await u.c.query(
        'INSERT INTO idempotency_records(session_id,method,path,key,actor_user_id,body_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(session_id,method,path,key) DO UPDATE SET body_hash=excluded.body_hash,response=excluded.response,expires_at=excluded.expires_at RETURNING response',
        [...args, s.userId, bodyHash, result, new Date(u.now.getTime() + 86_400_000).toISOString()],
      );
      return stored.rows[0].response as StoredResponse;
    });
  }
  async runSearch(
    requestId: string,
    inputVersion: InputVersion,
    deps: { feeRecommender?: FeeRecommender; now?: Date } = {},
  ): Promise<boolean> {
    return this.transaction(async (u) => {
      const r = await u.lockRequest(requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      if (r.status !== 'SEARCHING' || !(await u.inputCurrent(r, inputVersion))) return false;
      const need = ConfirmedNeedSchema.parse(r.need);
      const items = await all<Item>(
        u.c,
        'items',
        "WHERE data->>'category'=$1 AND (data->>'ownerId') IS DISTINCT FROM $2 ORDER BY id",
        [need.category, r.requesterId],
      );
      await u.lockItems(items.map((item) => item.id));
      const candidates: Candidate[] = [];
      for (const item of items) {
        if (!matchesItem(need.queryText, item)) continue;
        const placeId = need.preferredPlaceIds.find((p) => item.allowedPlaceIds.includes(p));
        const quote = await quoteFor(
          u,
          r,
          item,
          need.startAt,
          need.endAt,
          null,
          deps.feeRecommender ?? this.feeRecommender,
        );
        const terms = {
          startAt: need.startAt,
          endAt: need.endAt,
          placeId: placeId ?? item.allowedPlaceIds[0]!,
          totalFeeKrw: quote.recommendedKrw,
          currency: 'KRW' as const,
          quoteId: quote.id,
        };
        const reason = placeId
          ? await u.availability(item, r.requesterId, terms)
          : 'PLACE_UNAVAILABLE';
        candidates.push({
          id: id('candidate'),
          requestId: r.id,
          itemId: item.id,
          itemSummary: await u.itemSummary(item),
          quoteId: quote.id,
          suggestedTerms: terms,
          availability: reason ? 'UNAVAILABLE' : 'AVAILABLE',
          unavailableReason: reason,
        });
      }
      for (const c of candidates) await put(u.c, 'candidates', c, true);
      r.status = candidates.some((c) => c.availability === 'AVAILABLE')
        ? 'MATCHES_READY'
        : 'NO_MATCH';
      await u.changed(r, [], 'SEARCH_FINISHED');
      const tasks = await all<AgentTask>(
        u.c,
        'agent_tasks',
        "WHERE request_id=$1 AND data->>'kind'='SEARCH'",
        [r.id],
      );
      for (const task of tasks.filter(
        (t) => canonicalHash(t.inputVersion) === canonicalHash(inputVersion),
      )) {
        await this.effect(u, task, 'SEARCH');
        await this.finishInternal(u, task, null);
      }
      return true;
    }, deps.now);
  }
  async effect(u: Commands, task: AgentTask, step: string) {
    return !!(
      await u.c.query(
        'INSERT INTO task_effects(task_id,step,input_hash,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING task_id',
        [task.id, step, canonicalHash(task.inputVersion), u.iso],
      )
    ).rowCount;
  }
  async finishInternal(
    u: Commands,
    task: AgentTask,
    result: AiResult | null,
    status: AgentTask['status'] = 'SUCCEEDED',
    errorCode: string | null = null,
  ) {
    task.status = status;
    task.errorCode = errorCode;
    await put(u.c, 'agent_tasks', task);
    await u.c.query('UPDATE agent_tasks SET result=$2 WHERE id=$1', [task.id, result]);
    const actor = (await u.c.query('SELECT actor_user_id FROM agent_tasks WHERE id=$1', [task.id]))
      .rows[0].actor_user_id;
    await u.taskEvent(task, actor);
  }
  async applyPublicDecision(taskId: string, inputVersion: InputVersion): Promise<boolean> {
    return this.transaction(async (u) => {
      let task = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (
        !task ||
        task.kind !== 'PUBLIC_SUBMIT' ||
        !task.requestId ||
        canonicalHash(task.inputVersion) !== canonicalHash(inputVersion)
      )
        return false;
      const r = await u.lockRequest(task.requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      task = (await read<AgentTask>(u.c, 'agent_tasks', taskId))!;
      if (!(await u.inputCurrent(r, inputVersion))) {
        if (task.status === 'QUEUED' || task.status === 'RUNNING')
          await this.finishInternal(u, task, null, 'CANCELLED');
        return false;
      }
      if (!(await this.effect(u, task, 'PUBLIC_SUBMIT'))) return false;
      const n = ns.find((n) => n.id === task.negotiationId)!;
      await u.lockItems([n.itemId]);
      const item = await u.item(n.itemId);
      const reason = await u.availability(item, r.requesterId, n.terms);
      if (reason || item.publicScenario === 'DECLINE') {
        n.status = 'DECLINED';
        n.closedReason = 'PUBLIC_DEMO_DECLINED';
        n.responseDueAt = null;
      } else if (item.publicScenario !== 'APPROVE') {
        n.status = 'UNAVAILABLE';
        n.closedReason = 'PUBLIC_DEMO_ERROR';
      } else await u.makeOffer(r, n);
      u.noOffers(r, ns);
      await u.changed(r, [n], n.closedReason ?? 'PUBLIC_DEMO_APPROVED');
      await this.finishInternal(u, task, null);
      return true;
    });
  }
  async startTask(taskId: string): Promise<AgentTask | null> {
    return this.transaction(async (u) => {
      const task = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (!task?.requestId) return null;
      const r = await u.lockRequest(task.requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      const current = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (!current || !['QUEUED', 'RUNNING'].includes(current.status)) return null;
      if (!(await u.inputCurrent(r, current.inputVersion))) {
        await this.finishInternal(u, current, null, 'CANCELLED');
        return null;
      }
      if (current.attempt >= 3) {
        await this.finishInternal(
          u,
          current,
          await this.fallbackResult(u, current),
          'FAILED',
          'RETRY_LIMIT_REACHED',
        );
        if (current.kind === 'SEARCH' && r.status === 'SEARCHING') {
          r.status = 'FAILED';
          await u.changed(r, [], 'SEARCH_FAILED');
        } else if (current.kind === 'PUBLIC_SUBMIT') {
          const n = ns.find((n) => n.id === current.negotiationId);
          if (n && n.status === 'PENDING_PUBLIC') {
            n.status = 'UNAVAILABLE';
            n.closedReason = 'PUBLIC_DEMO_ERROR';
            u.noOffers(r, ns);
            await u.changed(r, [n], 'PUBLIC_DEMO_ERROR');
          }
        }
        return null;
      }
      current.status = 'RUNNING';
      current.attempt++;
      await put(u.c, 'agent_tasks', current);
      const row = (
        await u.c.query('SELECT actor_user_id FROM agent_tasks WHERE id=$1', [current.id])
      ).rows[0];
      await u.taskEvent(current, row.actor_user_id);
      return current;
    });
  }
  async fallbackResult(u: Commands, task: AgentTask): Promise<AiResult | null> {
    const context = (await u.c.query('SELECT context FROM agent_tasks WHERE id=$1', [task.id]))
      .rows[0]?.context;
    if (task.kind === 'EXPLAIN_TERMS' && context?.oldTerms && context?.newTerms)
      return {
        summary: '조건이 변경되었습니다. 기간·장소·총액을 확인해 주세요.',
        changedFields: changedFields(context.oldTerms as Terms, context.newTerms as Terms),
      };
    if (task.kind === 'COMPARE_OFFERS' && Array.isArray(context?.offers))
      return {
        summary: '도착한 제안의 기간·장소·총액을 비교해 주세요.',
        rows: context.offers.map(
          (offer: { negotiationId: string; termsRevision: number; terms: Terms }) => ({
            negotiationId: offer.negotiationId,
            termsRevision: offer.termsRevision,
            explanation: `총 대여료 ${formatKrw(offer.terms.totalFeeKrw)}. 기간과 장소를 함께 확인해 주세요.`,
          }),
        ),
      };
    return null;
  }
  async failTask(taskId: string, errorCode: string, final = false): Promise<void> {
    await this.transaction(async (u) => {
      let task = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (!task?.requestId) return;
      const r = await u.lockRequest(task.requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      task = (await read<AgentTask>(u.c, 'agent_tasks', taskId))!;
      if (
        !(await u.inputCurrent(r, task.inputVersion)) ||
        !['QUEUED', 'RUNNING'].includes(task.status)
      ) {
        if (['QUEUED', 'RUNNING'].includes(task.status))
          await this.finishInternal(u, task, null, 'CANCELLED');
        return;
      }
      if (!final && task.attempt < 3) {
        await this.finishInternal(u, task, null, 'QUEUED', errorCode);
        return;
      }
      await this.finishInternal(u, task, await this.fallbackResult(u, task), 'FAILED', errorCode);
      if (task.kind === 'SEARCH' && r.status === 'SEARCHING') {
        r.status = 'FAILED';
        await u.changed(r, [], 'SEARCH_FAILED');
      } else if (task.kind === 'PUBLIC_SUBMIT') {
        const n = ns.find((n) => n.id === task!.negotiationId);
        if (n && n.status === 'PENDING_PUBLIC') {
          n.status = 'UNAVAILABLE';
          n.closedReason = 'PUBLIC_DEMO_ERROR';
          u.noOffers(r, ns);
          await u.changed(r, [n], 'PUBLIC_DEMO_ERROR');
        }
      }
    });
  }
  async recordTaskResult(
    taskId: string,
    inputVersion: InputVersion,
    result: AiResult,
  ): Promise<boolean> {
    return this.transaction(async (u) => {
      let task = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (!task?.requestId || canonicalHash(task.inputVersion) !== canonicalHash(inputVersion))
        return false;
      const r = await u.lockRequest(task.requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      task = (await read<AgentTask>(u.c, 'agent_tasks', taskId))!;
      if (!(await u.inputCurrent(r, inputVersion))) {
        if (['QUEUED', 'RUNNING'].includes(task.status))
          await this.finishInternal(u, task, null, 'CANCELLED');
        return false;
      }
      const latest = await read<AgentTask>(u.c, 'agent_tasks', taskId);
      if (!latest || !['QUEUED', 'RUNNING'].includes(latest.status)) return false;
      if (task.kind === 'EXTRACT_NEED' && r.status !== 'DRAFT') {
        await this.finishInternal(u, task, null, 'CANCELLED');
        return false;
      }
      const schema = AI_RESULT_SCHEMAS[task.kind as keyof typeof AI_RESULT_SCHEMAS];
      if (!schema) fail('VALIDATION_ERROR');
      const parsed = schema.safeParse(result);
      if (!parsed.success) fail('VALIDATION_ERROR');
      if (inputVersion.kind === 'COMPARE' && 'rows' in parsed.data) {
        const rows = parsed.data.rows;
        if (
          new Set(rows.map((row) => row.negotiationId)).size !== rows.length ||
          rows.some(
            (row) =>
              !inputVersion.offers.some(
                (offer) =>
                  offer.negotiationId === row.negotiationId &&
                  offer.termsRevision === row.termsRevision,
              ),
          )
        )
          fail('VALIDATION_ERROR');
      }
      if (!(await this.effect(u, task, 'RESULT'))) return false;
      await this.finishInternal(u, task, parsed.data);
      if (task.kind === 'EXTRACT_NEED' && 'proposedNeed' in parsed.data) {
        const row = (await u.c.query('SELECT context FROM agent_tasks WHERE id=$1', [task.id]))
          .rows[0];
        // Only the explicit end-call command creates this server-owned capability.
        // Model output, ordinary extractions and spoken yes cannot enable it.
        if (row.context.finalizeAfterCall === true) {
          const saved = await u.patchDraft(r.requesterId, r.id, {
            expectedRequestVersion: r.version,
            need: parsed.data.proposedNeed,
          });
          const complete = ConfirmedNeedSchema.safeParse(saved.request.need);
          if (
            complete.success &&
            parsed.data.missingFields.length === 0 &&
            validatePeriod(complete.data.startAt, complete.data.endAt, u.now).valid
          ) {
            await u.confirmAndSearch(r.requesterId, r.id, saved.request.version);
          }
          await u.c.query("UPDATE agent_tasks SET context=context-'text' WHERE id=$1", [task.id]);
        }
      }
      if (
        task.kind === 'ROUTE_INTENT' &&
        inputVersion.kind === 'TURN' &&
        'intent' in parsed.data &&
        ['RENTAL_REQUEST', 'CHANGE_CONDITIONS', 'UNCLEAR'].includes(parsed.data.intent) &&
        r.status === 'DRAFT'
      ) {
        const row = (
          await u.c.query('SELECT actor_user_id,context FROM agent_tasks WHERE id=$1', [task.id])
        ).rows[0];
        await u.enqueue(
          'EXTRACT_NEED',
          r,
          { kind: 'NEED', needRevision: r.needRevision, turnId: inputVersion.turnId },
          row.actor_user_id,
          null,
          {
            text: row.context.text,
            draft: r.need,
            places: await u.places(),
            ...(row.context.voiceSessionId ? { voiceSessionId: row.context.voiceSessionId } : {}),
          },
        );
      }
      return true;
    });
  }
  /** Ephemeral voice inputs only; structured results and text-mode turns are retained. */
  async scrubVoiceTurnText(
    options: { turnIds?: string[]; olderThan?: Date } = {},
  ): Promise<number> {
    return this.transaction(async (u) => {
      const turnIds = options.turnIds ?? [];
      const cutoff = (options.olderThan ?? new Date(u.now.getTime() - 615_000)).toISOString();
      const targets = await u.c.query<{ request_id: string }>(
        `SELECT DISTINCT request_id FROM agent_tasks
         WHERE context ? 'voiceSessionId' AND context ? 'text'
           AND (data->'inputVersion'->>'turnId'=ANY($1::text[]) OR created_at<=$2)
         ORDER BY request_id`,
        [turnIds, cutoff],
      );
      let count = 0;
      for (const target of targets.rows) {
        // Serialize against ROUTE result -> EXTRACT creation and new text turns.
        await u.lockRequest(target.request_id);
        const rows = await u.c.query<{ turn_id: string }>(
          `UPDATE agent_tasks SET context=context-'text'
           WHERE request_id=$1 AND context ? 'voiceSessionId' AND context ? 'text'
             AND (data->'inputVersion'->>'turnId'=ANY($2::text[]) OR created_at<=$3)
           RETURNING data->'inputVersion'->>'turnId' AS turn_id`,
          [target.request_id, turnIds, cutoff],
        );
        count += rows.rowCount ?? 0;
        await u.c.query(
          'UPDATE rental_requests SET latest_turn_id=NULL WHERE id=$1 AND latest_turn_id=ANY($2::text[])',
          [target.request_id, rows.rows.map((row) => row.turn_id)],
        );
      }
      return count;
    });
  }
  async getTask(taskId: string, actor?: string): Promise<AgentTaskDetail> {
    return this.transaction(async (u) => {
      const row = (await u.c.query('SELECT * FROM agent_tasks WHERE id=$1', [taskId])).rows[0];
      if (!row) fail('NOT_FOUND');
      if (actor && row.actor_user_id !== actor) {
        const r = row.request_id
          ? await read<RentalRequest>(u.c, 'rental_requests', row.request_id)
          : null;
        const n = row.data.negotiationId
          ? await read<Negotiation>(u.c, 'negotiations', row.data.negotiationId)
          : null;
        if (r?.requesterId !== actor && n?.ownerId !== actor) fail('NOT_FOUND');
      }
      return { ...row.data, result: row.result };
    });
  }
  async getTaskInput(taskId: string): Promise<AiTaskInput | null> {
    return this.transaction(async (u) => {
      const row = (await u.c.query('SELECT * FROM agent_tasks WHERE id=$1', [taskId])).rows[0];
      if (!row) return null;
      const task = AgentTaskSchema.parse(row.data);
      if (task.kind === 'SEARCH' || task.kind === 'PUBLIC_SUBMIT' || !task.requestId) return null;
      const context = { ...row.context };
      // Retention metadata is internal, never part of the strict AI input contract.
      delete context.voiceSessionId;
      delete context.finalizeAfterCall;
      return {
        taskId: task.id,
        kind: task.kind,
        actorUserId: row.actor_user_id,
        requestId: task.requestId,
        negotiationId: task.negotiationId,
        inputVersion: task.inputVersion,
        locale: 'ko-KR',
        timeZone: 'Asia/Seoul',
        serverNow: u.iso,
        context,
      } as AiTaskInput;
    });
  }
  async enqueueTask(
    requestId: string,
    kind: AgentTaskKind,
    inputVersion: InputVersion,
    context: Record<string, unknown> = {},
    actor?: string,
    negotiationId: string | null = null,
  ) {
    return this.transaction(async (u) => {
      const r = await u.lockRequest(requestId);
      const ns = await u.lockNegotiations(r.id);
      await u.expire(r, ns);
      if (!(await u.inputCurrent(r, inputVersion))) fail('INVALID_STATE');
      return u.enqueue(kind, r, inputVersion, actor ?? r.requesterId, negotiationId, context);
    });
  }
  async expireDue(now = this.now()): Promise<number> {
    const rows = await this.pool.query(
      "SELECT id FROM rental_requests WHERE data->>'status' NOT IN ('NO_MATCH','FAILED','NO_OFFERS','CANCELLED','EXPIRED') ORDER BY id",
    );
    for (const row of rows.rows)
      await this.transaction(async (u) => {
        const r = await u.lockRequest(row.id);
        const ns = await u.lockNegotiations(r.id);
        await u.expire(r, ns);
      }, now);
    await this.pool.query('DELETE FROM user_events WHERE occurred_at<$1;', [
      new Date(now.getTime() - 86_400_000).toISOString(),
    ]);
    await this.pool.query('DELETE FROM idempotency_records WHERE expires_at<=$1', [
      now.toISOString(),
    ]);
    return rows.rowCount ?? 0;
  }
  async sync(actor: string): Promise<SyncData> {
    // Perform lazy expiry first, then read all projections and cursor from one MVCC snapshot.
    const ids = await this.pool.query(
      'SELECT DISTINCT r.id FROM rental_requests r LEFT JOIN negotiations n ON n.request_id=r.id WHERE r.requester_id=$1 OR n.owner_id=$1 ORDER BY r.id',
      [actor],
    );
    for (const row of ids.rows)
      await this.transaction(async (u) => {
        const r = await u.lockRequest(row.id);
        const ns = await u.lockNegotiations(r.id);
        await u.expire(r, ns);
      });
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const u = new Commands(c, this.now());
      const requestSummaries = [];
      for (const r of await all<RentalRequest>(
        c,
        'rental_requests',
        'WHERE requester_id=$1 ORDER BY id',
        [actor],
      ))
        requestSummaries.push(await u.summary(r));
      const ownerCards = [];
      for (const n of await all<Negotiation>(c, 'negotiations', 'WHERE owner_id=$1 ORDER BY id', [
        actor,
      ]))
        ownerCards.push(
          await u.ownerCard((await read<RentalRequest>(c, 'rental_requests', n.requestId))!, n),
        );
      const tasks = (
        await c.query(
          "SELECT t.data FROM agent_tasks t LEFT JOIN rental_requests r ON r.id=t.request_id LEFT JOIN negotiations n ON n.id=t.data->>'negotiationId' WHERE t.actor_user_id=$1 OR r.requester_id=$1 OR n.owner_id=$1 ORDER BY t.created_at,t.id",
          [actor],
        )
      ).rows.map((row) => row.data as AgentTask);
      const eventCursor = (
        await c.query('SELECT event_cursor::text FROM users WHERE id=$1', [actor])
      ).rows[0].event_cursor;
      await c.query('COMMIT');
      return { requestSummaries, ownerCards, tasks, eventCursor };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async eventsAfter(actor: string, after: string) {
    const now = this.now();
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const row = (await c.query('SELECT event_cursor::text FROM users WHERE id=$1', [actor]))
        .rows[0];
      if (!row) fail('NOT_FOUND');
      const earliest = (
        await c.query(
          'SELECT min(cursor)::text AS cursor FROM user_events WHERE user_id=$1 AND occurred_at>$2',
          [actor, new Date(now.getTime() - 86_400_000).toISOString()],
        )
      ).rows[0].cursor as string | null;
      const expired =
        BigInt(after) > BigInt(row.event_cursor) ||
        BigInt(after) < (earliest ? BigInt(earliest) - 1n : BigInt(row.event_cursor));
      const events = expired
        ? []
        : (
            await c.query(
              'SELECT data FROM user_events WHERE user_id=$1 AND cursor>$2 AND occurred_at>$3 ORDER BY cursor',
              [actor, after, new Date(now.getTime() - 86_400_000).toISOString()],
            )
          ).rows.map((r) => r.data);
      await c.query('COMMIT');
      return { expired, events, cursor: row.event_cursor as string };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async pendingOutbox(limit = 100) {
    return (
      await this.pool.query(
        'SELECT id::text,kind,payload,created_at FROM outbox WHERE delivered_at IS NULL ORDER BY id LIMIT $1',
        [limit],
      )
    ).rows as {
      id: string;
      kind: 'TASK' | 'EVENT';
      payload: Record<string, string>;
      created_at: Date;
    }[];
  }
  async markOutboxDelivered(outboxId: string) {
    await this.pool.query(
      'UPDATE outbox SET delivered_at=$2,attempts=attempts+1 WHERE id=$1 AND delivered_at IS NULL',
      [outboxId, this.now().toISOString()],
    );
  }
  async injectOwnerResponse(actor: string, negotiationId: string, body: OwnerResponseBody) {
    if (process.env.APP_MODE !== 'automated-test')
      throw new Error('Owner response injection requires APP_MODE=automated-test');
    return this.transaction((u) => u.ownerResponse(actor, negotiationId, body));
  }
}
