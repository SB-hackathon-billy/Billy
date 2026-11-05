// 1번 접수 → 예약 신청 도구. 명세: docs/specs/0003-voice-call-reservation.md
// 사람이 통화 화면의 바텀시트에서 최종 승인한 경우에만 실행된다. 도구는 기존 예약 계약
// (patchDraft → confirmAndSearch → issueQuote → submit)만 호출하고 타 모듈 테이블에 직접 쓰지 않는다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as C from '@sb/contracts';
import { DomainError, fail, id, read, type Commands, type Database } from '@sb/db';

const TABLE = 'intake_approvals';
const MAX_SELECTIONS = 3;
const SEARCH_POLL_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
type Job = C.IntakeApproval;

export const backoffMs = (attempts: number) =>
  Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.max(0, attempts - 1));

async function save(u: Commands, job: Job, insert = false) {
  C.IntakeApprovalSchema.parse(job);
  await u.c.query(
    insert
      ? `INSERT INTO ${TABLE}(id,data,next_attempt_at) VALUES($1,$2,$3)`
      : `UPDATE ${TABLE} SET data=$2, next_attempt_at=$3 WHERE id=$1`,
    [job.id, job, job.nextAttemptAt],
  );
}

/** Candidates the requester can actually reserve: center (PUBLIC) items first, then lowest fee. */
export function pickCandidates(candidates: readonly C.Candidate[]): C.Candidate[] {
  return candidates
    .filter((c) => c.availability === 'AVAILABLE')
    .sort(
      (a, b) =>
        Number(b.itemSummary.source === 'PUBLIC') - Number(a.itemSummary.source === 'PUBLIC') ||
        a.suggestedTerms.totalFeeKrw - b.suggestedTerms.totalFeeKrw ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_SELECTIONS);
}

const submittedStatuses: C.RequestStatus[] = ['COLLECTING_OFFERS', 'PAYMENT_PREVIEW_READY'];
const closedStatuses: C.RequestStatus[] = ['CANCELLED', 'EXPIRED', 'FAILED', 'NO_OFFERS'];

/** One tool step. Throws DomainError on failure; the caller records the retry. */
async function advance(u: Commands, db: Database, job: Job): Promise<Job> {
  const actor = job.requesterId;
  let view = await u.getRequest(actor, job.requestId);
  const done = (status: C.IntakeApprovalStatus, negotiationIds = job.negotiationIds): Job => ({
    ...job,
    status,
    step: 'DONE',
    negotiationIds,
    lastErrorCode: null,
    nextAttemptAt: null,
  });
  const status = view.request.status;
  if (submittedStatuses.includes(status))
    return done(
      'SUBMITTED',
      job.negotiationIds.length
        ? job.negotiationIds
        : view.negotiations.slice(0, MAX_SELECTIONS).map((n) => n.id),
    );
  if (closedStatuses.includes(status)) return done('CLOSED');
  if (status === 'NO_MATCH') return done('NO_MATCH');
  if (status === 'DRAFT') {
    // Apply the human-approved summary, then confirm it exactly as the editor's search button does.
    if (C.canonicalHash(view.request.need) !== C.canonicalHash(job.need))
      view = await u.patchDraft(actor, job.requestId, {
        expectedRequestVersion: view.request.version,
        need: job.need,
      });
    await u.confirmAndSearch(actor, job.requestId, view.request.version);
    return {
      ...job,
      status: 'SEARCHING',
      step: 'SUBMIT',
      lastErrorCode: null,
      nextAttemptAt: soon(u),
    };
  }
  if (status === 'SEARCHING')
    return {
      ...job,
      status: 'SEARCHING',
      step: 'SUBMIT',
      lastErrorCode: null,
      nextAttemptAt: soon(u),
    };
  // MATCHES_READY: request the reservation from the best available candidates.
  const picked = pickCandidates(view.candidates);
  if (!picked.length) return done('NO_MATCH');
  const selections: C.CandidateSelection[] = [];
  for (const candidate of picked) {
    const stored = await read<C.PricingQuote>(u.c, 'pricing_quotes', candidate.quoteId);
    const fresh = stored && u.now.getTime() < Date.parse(stored.expiresAt);
    const quote = fresh
      ? stored
      : await u.issueQuote(
          actor,
          {
            requestId: job.requestId,
            negotiationId: null,
            itemId: candidate.itemId,
            startAt: candidate.suggestedTerms.startAt,
            endAt: candidate.suggestedTerms.endAt,
          },
          db.feeRecommender,
        );
    selections.push({
      candidateId: candidate.id,
      quoteId: quote.id,
      totalFeeKrw: fresh ? candidate.suggestedTerms.totalFeeKrw : quote.recommendedKrw,
    });
  }
  view = await u.getRequest(actor, job.requestId);
  const submitted = await u.submit(actor, job.requestId, {
    expectedRequestVersion: view.request.version,
    selections,
  });
  const itemIds = new Set(picked.map((c) => c.itemId));
  return done(
    'SUBMITTED',
    submitted.negotiations.filter((n) => itemIds.has(n.itemId)).map((n) => n.id),
  );
}
const soon = (u: Commands) => new Date(u.now.getTime() + SEARCH_POLL_MS).toISOString();

/** Run one step inside a savepoint so a failed tool call never rolls back the job record. */
async function attempt(u: Commands, db: Database, job: Job): Promise<Job> {
  const events = u.events.length;
  await u.c.query('SAVEPOINT intake_tool');
  try {
    const next = await advance(u, db, job);
    await u.c.query('RELEASE SAVEPOINT intake_tool');
    // attempts counts consecutive failures; a successful step resets the backoff.
    return { ...next, attempts: 0, updatedAt: u.iso };
  } catch (error) {
    await u.c.query('ROLLBACK TO SAVEPOINT intake_tool');
    u.events.length = events;
    const attempts = job.attempts + 1;
    const code = error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
    return {
      ...job,
      status: 'RETRYING',
      attempts,
      lastErrorCode: code,
      nextAttemptAt: new Date(u.now.getTime() + backoffMs(attempts)).toISOString(),
      updatedAt: u.iso,
    };
  }
}

export default async function intakeApprovalsPlugin(app: FastifyInstance) {
  const { db, envelope, requireSession, mutation } = app.demo;
  const param = (r: FastifyRequest) =>
    C.IntakeApprovalIdSchema.parse((r.params as { id: string }).id);
  const log = (event: string, job: Job) =>
    app.log.info(
      {
        tool: job.tool,
        approvalId: job.id,
        status: job.status,
        attempts: job.attempts,
        errorCode: job.lastErrorCode,
      },
      event,
    );

  mutation('POST', '/intake-approvals', 202, async (u, request) => {
    const body = C.CreateIntakeApprovalBodySchema.parse(request.body);
    const actor = requireSession(request).userId;
    const view = await u.getRequest(actor, body.requestId);
    const existing = (
      await u.c.query(`SELECT data FROM ${TABLE} WHERE request_id=$1 FOR UPDATE`, [body.requestId])
    ).rows[0]?.data as Job | undefined;
    if (existing) return existing;
    if (view.request.status !== 'DRAFT') fail('INVALID_STATE');
    if (view.request.version !== body.expectedRequestVersion)
      fail('VERSION_CONFLICT', { currentVersion: view.request.version });
    const task = await db.getTask(body.extractionTaskId, actor);
    const extraction = C.ExtractNeedResultSchema.safeParse(task.result);
    if (
      task.requestId !== body.requestId ||
      task.kind !== 'EXTRACT_NEED' ||
      task.status !== 'SUCCEEDED' ||
      !extraction.success
    )
      fail('INVALID_STATE');
    if (!C.isNeedCollectionComplete(extraction.data, u.now))
      fail('VALIDATION_ERROR', { fields: extraction.data.missingFields });
    const job: Job = {
      id: id('iap'),
      requestId: body.requestId,
      requesterId: actor,
      voiceSessionId: body.voiceSessionId ?? null,
      extractionTaskId: task.id,
      tool: C.RESERVATION_TOOL_NAME,
      status: 'QUEUED',
      step: 'CONFIRM',
      need: C.ConfirmedNeedSchema.parse(extraction.data.proposedNeed),
      attempts: 0,
      lastErrorCode: null,
      nextAttemptAt: null,
      negotiationIds: [],
      createdAt: u.iso,
      updatedAt: u.iso,
    };
    // The first tool call runs now; a failure is stored as RETRYING and continued in the background.
    const next = await attempt(u, db, job);
    await save(u, next, true);
    log('intake_approval.created', next);
    return next;
  });

  app.get('/api/v1/intake-approvals/:id', async (request) => {
    const actor = requireSession(request).userId;
    const job = await read<Job>(db.pool, TABLE, param(request));
    if (!job || job.requesterId !== actor) fail('NOT_FOUND');
    return envelope(job);
  });

  let stopping = false;
  let running: Promise<void> | undefined;
  /** Background retry: claim due jobs with SKIP LOCKED so several API instances never double-run. */
  const tick = async () => {
    for (let i = 0; i < 20 && !stopping; i++) {
      const progressed = await db.transaction(async (u) => {
        const row = (
          await u.c.query(
            `SELECT data FROM ${TABLE} WHERE status IN ('QUEUED','SEARCHING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY next_attempt_at NULLS FIRST, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [u.iso],
          )
        ).rows[0]?.data as Job | undefined;
        if (!row) return false;
        const next = await attempt(u, db, row);
        await save(u, next);
        if (next.status !== row.status || next.lastErrorCode) log('intake_approval.step', next);
        return true;
      });
      if (!progressed) return;
    }
  };
  const run = () =>
    (running ??= tick()
      .catch(() => app.log.warn('Intake approval retry loop failed'))
      .finally(() => {
        running = undefined;
      }));
  const timer = setInterval(() => {
    if (!stopping) void run();
  }, 1_000);
  timer.unref();
  // Serialized with the interval so a manual pass (tests, ops) never races the background one.
  app.decorate('intakeApprovals', {
    tick: async () => {
      await running;
      await run();
    },
  });
  app.addHook('preClose', async () => {
    stopping = true;
    clearInterval(timer);
    await running;
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    intakeApprovals: { tick: () => Promise<void> };
  }
}
// Root-level decorator so tests (and other plugins) can drive the retry loop deterministically.
Object.defineProperty(intakeApprovalsPlugin, Symbol.for('skip-override'), { value: true });
