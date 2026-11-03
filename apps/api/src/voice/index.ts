import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createVoiceGateway,
  createVoiceTurnChecker,
  VOICE_GREETING,
  VOICE_LIMITS,
  VOICE_AGENT,
  VOICE_RULES,
  type CreateVoiceSessionInput,
} from '@sb/ai';
import {
  VoiceSessionBodySchema,
  VoiceCompletionAudioQuerySchema,
  canonicalJson,
  VOICE_COMPLETION_NOTICE,
  type VoiceCompletion,
  FinishVoiceBodySchema,
  VoiceRespondBodySchema,
  IdSchema,
  ExtractNeedResultSchema,
  formatSeoulDateTime,
  type VoiceGatewaySession,
  type VoiceGatewayEvent,
  type AgentTask,
} from '@sb/contracts';
import { fail, id, type Session } from '@sb/db';
import { proposeVoiceSummary, verifiedVoiceContext as verifiedContext } from './bindings.js';
import { CompletionAudio } from './completion-audio.js';
import { collectionComplete, currentVoiceTurn } from './guards.js';

type Pending = {
  delegationId: string | null;
  taskId: string;
  turnId: string;
  inputRevision: number;
};
type Connection = {
  id: string;
  requestId: string;
  session: Session;
  token: string;
  createdAt: number;
  active: boolean;
  provider?: VoiceGatewaySession;
  userText: string;
  finalText?: string;
  formTaskId: string | null;
  repliedRevision: number;
  completion: VoiceCompletion | null;
  completionAnnounced: boolean;
  completedNeed?: import('@sb/contracts').ExtractNeedResult;
  finishBody?: string;
  completionAudio?: CompletionAudio;
  completionAudioDelivered?: boolean;
  turnStatus: 'WAITING' | 'READY' | 'BLOCKED';
  turnTimer?: ReturnType<typeof setTimeout>;
  inputRevision: number;
  lastDelegatedRevision: number;
  delegations: Set<string>;
  turns: Set<string>;
  pending: Map<string, Pending>;
  work: Promise<void>;
  closed?: Promise<void>;
  deadline?: ReturnType<typeof setTimeout>;
};
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

/** The only executable voice capability is the same proposal command as /agent-turns. */
export async function voicePlugin(app: FastifyInstance) {
  const { db, mutation, requireSession, cookieName } = app.demo;
  const connections = new Map<string, Connection>();
  let stopping = false;
  let polling: Promise<void> | undefined;
  let lastScrub = 0;
  const diagnostic = (event: string, connection: Connection, extra: Record<string, unknown> = {}) =>
    app.log.info(
      {
        roleId: VOICE_AGENT.id,
        promptVersion: VOICE_AGENT.promptVersion,
        voiceSessionId: connection.id,
        ...extra,
      },
      event,
    );
  const append = async (
    connection: Connection,
    kind: 'thinking' | 'commentary' | 'instructions',
    delegationId: string | null,
    content: string,
  ) => {
    if (!connection.active || !connection.provider) return false;
    try {
      await connection.provider.append({
        type:
          kind === 'thinking'
            ? 'session.thinking.append'
            : kind === 'instructions'
              ? 'session.instructions.append'
              : 'session.commentary.append',
        eventId: randomUUID(),
        delegationId,
        content,
      });
      diagnostic('voice.append_confirmed', connection, { kind, delegated: delegationId !== null });
      return true;
    } catch {
      diagnostic('voice.append_unconfirmed', connection, { kind });
      return false;
    }
  };
  const close = (connection: Connection): Promise<void> => {
    if (connection.closed) return connection.closed;
    connection.active = false;
    connection.userText = '';
    connection.completion = null;
    delete connection.completedNeed;
    delete connection.completionAudio;
    delete connection.completionAudioDelivered;
    connection.pending.clear();
    connection.delegations.clear();
    clearTimeout(connection.deadline);
    clearTimeout(connection.turnTimer);
    connection.closed = Promise.resolve().then(async () => {
      // Send session.close immediately; the gateway caps confirmation at 15 seconds.
      const providerClose = connection.provider?.close().catch(() => ({ confirmed: false }));
      await connection.work;
      await db.scrubVoiceTurnText({ turnIds: [...connection.turns] });
      connection.turns.clear();
      const result = await providerClose;
      diagnostic('voice.closed', connection, { confirmed: result?.confirmed ?? false });
      delete connection.provider;
      connection.token = '';
    });
    return connection.closed;
  };
  const safeClose = (connection: Connection) => {
    void close(connection).catch(() => {
      // Persisted voice markers allow the periodic/startup privacy sweep to retry.
      diagnostic('voice.cleanup_failed', connection);
    });
  };
  const delegate = async (connection: Connection, delegationId: string | null) => {
    if (!connection.active || !connection.provider || connection.turnStatus !== 'READY') return;
    const text = connection.userText.trim().slice(-2000);
    const revision = connection.inputRevision;
    if (!text || revision === connection.lastDelegatedRevision) return;
    const result = await proposeVoiceSummary(db, connection, text, () =>
      currentVoiceTurn(connection, revision),
    );
    if (!result) return;
    const task = await db.getTask(result.taskId, connection.session.userId);
    if (task.inputVersion.kind !== 'TURN') return;
    connection.turns.add(task.inputVersion.turnId);
    if (!currentVoiceTurn(connection, revision)) return;
    connection.lastDelegatedRevision = revision;
    connection.pending.set(delegationId ?? `turn-${revision}`, {
      delegationId,
      taskId: task.id,
      turnId: task.inputVersion.turnId,
      inputRevision: revision,
    });
    diagnostic('voice.delegation_queued', connection, { taskId: task.id });
    // Do not block the task queue on playback/append acknowledgment.
    void append(
      connection,
      'thinking',
      delegationId,
      `신청서 항목을 추출하고 있습니다. 재고 조회는 아직 하지 않았습니다. 서버 문맥: ${result.context}`,
    );
  };

  const checkTurn = async (connection: Connection, revision: number) => {
    if (!connection.active || revision !== connection.inputRevision) return;
    try {
      const decision = await createVoiceTurnChecker()(connection.userText);
      if (!connection.active || revision !== connection.inputRevision) return;
      diagnostic('voice.turn_checked', connection, {
        revision,
        complete: decision.complete,
        scope: decision.scope,
      });
      if (!decision.complete) return;
      if (decision.scope !== 'ALLOWED') {
        connection.turnStatus = 'BLOCKED';
        return;
      }
      connection.turnStatus = 'READY';
      connection.work = connection.work
        .then(() => delegate(connection, null))
        .catch(() => {
          diagnostic('voice.delegation_failed', connection);
        });
    } catch {
      diagnostic('voice.turn_check_failed', connection, { revision });
      // Keep playback closed and allow the next utterance or explicit finish to retry.
    }
  };

  const onEvent = (connection: Connection, event: VoiceGatewayEvent) => {
    if (
      event.type === 'session.closed' ||
      event.type === 'disconnected' ||
      event.type === 'error'
    ) {
      safeClose(connection);
      return;
    }
    if (!connection.active) return;
    if (event.type === 'session.output_audio.delta') {
      connection.completionAudio?.addAudio(event, event.delta);
      return;
    }
    if (
      event.type === 'session.output_transcript.delta' &&
      event.startMs !== undefined &&
      event.endMs !== undefined
    ) {
      connection.completionAudio?.addTranscript(
        { startMs: event.startMs, endMs: event.endMs },
        event.delta,
      );
      return;
    }
    if (event.type === 'session.input_transcript.delta') {
      if (connection.turnStatus !== 'WAITING') {
        void append(connection, 'instructions', null, VOICE_RULES.listening);
      }
      connection.userText = (connection.userText + event.delta).slice(-2000);
      connection.inputRevision++;
      connection.completion = null;
      connection.completionAnnounced = false;
      delete connection.completedNeed;
      delete connection.completionAudio;
      delete connection.completionAudioDelivered;
      connection.turnStatus = 'WAITING';
      clearTimeout(connection.turnTimer);
      const revision = connection.inputRevision;
      connection.turnTimer = setTimeout(() => {
        void checkTurn(connection, revision);
      }, 900);
      connection.turnTimer.unref();
    } else if (
      event.type === 'session.delegation.created' &&
      !connection.delegations.has(event.delegationId)
    ) {
      connection.delegations.add(event.delegationId);
      // A provider delegation does not establish that the caller has finished.
      void append(connection, 'thinking', event.delegationId, VOICE_RULES.waiting);
    }
    // Output transcript (including claims of approval/payment) has no command path.
  };

  mutation('POST', '/voice-sessions', 201, async (u, request) => {
    const body = VoiceSessionBodySchema.parse(request.body);
    const session = requireSession(request);
    const view = await u.getRequest(session.userId, body.requestId);
    if (stopping) fail('AI_UNAVAILABLE');
    if (view.request.status !== 'DRAFT') fail('INVALID_STATE');
    if (
      [...connections.values()].some((entry) => entry.active && entry.requestId === body.requestId)
    )
      fail('INVALID_STATE');
    const connection: Connection = {
      id: id('voice'),
      requestId: body.requestId,
      session,
      token: request.cookies[cookieName]!,
      createdAt: Date.now(),
      active: true,
      userText: '',
      turnStatus: 'READY',
      formTaskId: null,
      repliedRevision: 0,
      completion: null,
      completionAnnounced: false,
      inputRevision: 0,
      lastDelegatedRevision: 0,
      delegations: new Set(),
      turns: new Set(),
      pending: new Map(),
      work: Promise.resolve(),
    };
    connections.set(connection.id, connection);
    try {
      const input: CreateVoiceSessionInput = {
        requestId: body.requestId,
        actorUserId: session.userId,
        sdpOffer: body.sdpOffer,
        onEvent: (event) => onEvent(connection, event),
        instructions: VOICE_AGENT.requestInstructions,
        tools: VOICE_AGENT.backendCapabilities,
      };
      connection.provider = await createVoiceGateway().createSession(input);
      if (!connection.active || stopping) {
        await connection.provider.close();
        fail('AI_UNAVAILABLE');
      }
      connection.deadline = setTimeout(() => safeClose(connection), VOICE_LIMITS.maxDurationMs);
      connection.deadline.unref();
      // A fresh Live session receives DB facts, never an old delegation identifier.
      void append(
        connection,
        'thinking',
        null,
        `새 음성 연결의 서버 문맥입니다. ${verifiedContext(view)}`,
      );
      void append(connection, 'commentary', null, VOICE_GREETING);
      diagnostic('voice.ready', connection, { elapsedMs: Date.now() - connection.createdAt });
      return { voiceSessionId: connection.id, sdpAnswer: connection.provider.sdpAnswer };
    } catch {
      safeClose(connection);
      fail('AI_UNAVAILABLE');
    }
  });
  app.get('/api/v1/voice-sessions/:id', async (request) => {
    const connection = connections.get(IdSchema.parse((request.params as { id: string }).id));
    if (!connection || connection.session.id !== requireSession(request).id) fail('NOT_FOUND');
    return app.demo.envelope({
      inputRevision: connection.inputRevision,
      turnStatus: connection.turnStatus,
      active: connection.active,
      taskId: connection.formTaskId,
      completion: connection.completion,
    });
  });
  app.get('/api/v1/voice-sessions/:id/completion-audio', async (request) => {
    const query = VoiceCompletionAudioQuerySchema.parse(request.query);
    const connection = connections.get(IdSchema.parse((request.params as { id: string }).id));
    if (!connection || connection.session.id !== requireSession(request).id) fail('NOT_FOUND');
    if (
      !currentVoiceTurn(connection, query.inputRevision) ||
      !connection.completionAnnounced ||
      connection.completion?.taskId !== query.taskId
    )
      fail('INVALID_STATE');
    const audioWav = connection.completionAudio?.wav() ?? null;
    diagnostic('voice.completion_audio', connection, connection.completionAudio?.diagnostics());
    if (audioWav) connection.completionAudioDelivered = true;
    return app.demo.envelope({ completion: connection.completion, audioWav });
  });
  mutation('POST', '/voice-sessions/:id/respond', 204, async (_u, request) => {
    const body = VoiceRespondBodySchema.parse(request.body);
    const connection = connections.get(IdSchema.parse((request.params as { id: string }).id));
    if (!connection || connection.session.id !== requireSession(request).id) fail('NOT_FOUND');
    if (
      !connection.active ||
      connection.turnStatus === 'WAITING' ||
      body.inputRevision !== connection.inputRevision
    )
      fail('INVALID_STATE');
    if (body.completionTaskId) {
      if (
        !currentVoiceTurn(connection, body.inputRevision) ||
        connection.completion?.taskId !== body.completionTaskId ||
        !connection.completedNeed ||
        !collectionComplete(connection.completedNeed, db.now().toISOString())
      )
        fail('INVALID_STATE');
      if (connection.completionAnnounced) return;
      connection.completionAudio = new CompletionAudio();
      connection.completionAudioDelivered = false;
      const confirmed = await append(
        connection,
        'instructions',
        null,
        `서버가 필수 정보 수집 완료를 검증했습니다. 추가 질문 없이 다음 문장만 처음부터 정확히 한 번 말한 뒤 멈추세요: ${VOICE_COMPLETION_NOTICE} 아직 조회한 것은 아닙니다. 실제 결제와 예약은 이루어지지 않습니다.`,
      );
      if (!confirmed) fail('AI_UNAVAILABLE');
      if (
        !currentVoiceTurn(connection, body.inputRevision) ||
        connection.completion?.taskId !== body.completionTaskId
      )
        fail('INVALID_STATE');
      connection.completionAnnounced = true;
      return;
    }
    if (connection.repliedRevision === body.inputRevision) return;
    connection.repliedRevision = body.inputRevision;
    void append(
      connection,
      'instructions',
      null,
      connection.turnStatus === 'BLOCKED' ? VOICE_RULES.blocked : VOICE_RULES.respond,
    );
  });
  mutation('POST', '/voice-sessions/:id/finish', 202, async (u, request) => {
    const body = FinishVoiceBodySchema.parse(request.body);
    const connection = connections.get(IdSchema.parse((request.params as { id: string }).id));
    if (!connection || connection.session.id !== requireSession(request).id) fail('NOT_FOUND');
    if (body.completion && connection.finishBody && connection.finishBody !== canonicalJson(body))
      fail('INVALID_STATE');
    if (body.completion && !connection.finishBody) {
      const expected = body.completion;
      if (
        !currentVoiceTurn(connection, expected.inputRevision) ||
        !connection.completionAnnounced ||
        !connection.completionAudioDelivered ||
        connection.completion?.taskId !== expected.taskId ||
        connection.completion.requestVersion !== expected.requestVersion ||
        body.expectedRequestVersion !== expected.requestVersion ||
        !connection.completedNeed ||
        !collectionComplete(connection.completedNeed, db.now().toISOString())
      )
        fail('INVALID_STATE');
      // Check the current request before stopping the call. Recheck revision after the DB await.
      const view = await db.transaction((reader) =>
        reader.getRequest(connection.session.userId, connection.requestId),
      );
      if (connection.finishBody) {
        if (connection.finishBody !== canonicalJson(body)) fail('INVALID_STATE');
      } else if (
        view.request.version !== expected.requestVersion ||
        view.request.status !== 'DRAFT' ||
        !currentVoiceTurn(connection, expected.inputRevision)
      )
        fail('VERSION_CONFLICT');
    }
    connection.finishBody ??= canonicalJson(body);
    connection.finalText ??= connection.userText.trim();
    // Stop provider and pending collection before acquiring a domain request lock.
    await close(connection);
    if (!connection.finalText) fail('VALIDATION_ERROR');
    let decision;
    try {
      decision = await createVoiceTurnChecker()(connection.finalText, true);
    } catch {
      fail('AI_UNAVAILABLE');
    }
    if (!decision.complete || decision.scope !== 'ALLOWED') fail('VALIDATION_ERROR');
    const accepted = await u.finishVoice(
      connection.session.userId,
      {
        requestId: connection.requestId,
        expectedRequestVersion: body.expectedRequestVersion,
        text: connection.finalText,
      },
      connection.id,
    );
    // The idempotency record and extraction task commit together. Keep finalText for
    // retries until the transaction has committed; it expires with the connection.
    return accepted;
  });
  mutation('DELETE', '/voice-sessions/:id', 204, async (_u, request) => {
    if (request.body !== undefined && request.body !== null)
      z.object({}).strict().parse(request.body);
    const voiceId = IdSchema.parse((request.params as { id: string }).id);
    const connection = connections.get(voiceId);
    if (!connection || connection.session.id !== requireSession(request).id) fail('NOT_FOUND');
    await close(connection);
  });

  const resultFor = async (connection: Connection, pending: Pending, tasks: AgentTask[]) => {
    const task = await db.getTask(pending.taskId, connection.session.userId);
    if (!terminal.has(task.status)) return;
    if (task.status === 'SUCCEEDED' && task.kind === 'ROUTE_INTENT') {
      // The route may have committed after this poll's snapshot. Re-read before
      // deciding there is no extraction, so its result is never skipped.
      const latest = tasks.some((t) => t.id === task.id && t.status === 'SUCCEEDED')
        ? tasks
        : (await db.sync(connection.session.userId)).tasks;
      const extraction = latest.find(
        (t) =>
          t.kind === 'EXTRACT_NEED' &&
          'turnId' in t.inputVersion &&
          t.inputVersion.turnId === pending.turnId,
      );
      if (extraction) {
        pending.taskId = extraction.id;
        return;
      }
    }
    connection.pending.delete(pending.delegationId ?? `turn-${pending.inputRevision}`);
    // Text arriving during a model call makes its spoken result stale, even before the next delegation.
    if (!currentVoiceTurn(connection, pending.inputRevision) || task.status === 'CANCELLED') return;
    if (task.kind === 'EXTRACT_NEED' && task.status === 'SUCCEEDED') {
      const parsed = ExtractNeedResultSchema.safeParse(task.result);
      if (parsed.success) {
        const view = await db.transaction((u) =>
          u.getRequest(connection.session.userId, connection.requestId),
        );
        if (!currentVoiceTurn(connection, pending.inputRevision)) return;
        connection.formTaskId = task.id;
        if (
          view.request.status === 'DRAFT' &&
          task.inputVersion.kind === 'NEED' &&
          task.inputVersion.needRevision === view.request.needRevision &&
          collectionComplete(parsed.data, db.now().toISOString())
        ) {
          connection.completion = {
            taskId: task.id,
            inputRevision: pending.inputRevision,
            requestVersion: view.request.version,
          };
          connection.completedNeed = parsed.data;
          connection.completionAnnounced = false;
        }
        const { proposedNeed: need, clarificationQuestion } = parsed.data;
        const period =
          need.startAt && need.endAt
            ? `${formatSeoulDateTime(need.startAt)}부터 ${formatSeoulDateTime(need.endAt)}까지`
            : '기간 확인 필요';
        void append(
          connection,
          'thinking',
          pending.delegationId,
          `실시간 신청서 항목: ${need.queryText || '물품 확인 필요'}, ${period}. ${clarificationQuestion ?? '수집된 항목을 화면 신청서에 표시했습니다.'} 아직 전송되지 않았습니다.`,
        );
        diagnostic('voice.summary_ready', connection, { taskId: task.id });
        return;
      }
    }
    if (task.status === 'FAILED') {
      void append(
        connection,
        'commentary',
        pending.delegationId,
        '조건 요약을 만들지 못했습니다. 화면에서 다시 입력해 주세요. 요청은 전송되지 않았습니다.',
      );
    } else {
      const view = await db.transaction((u) =>
        u.getRequest(connection.session.userId, connection.requestId),
      );
      if (!currentVoiceTurn(connection, pending.inputRevision)) return;
      void append(
        connection,
        'commentary',
        pending.delegationId,
        `현재 서버 정보입니다. ${verifiedContext(view)}`,
      );
    }
  };
  const poll = async () => {
    const active = [...connections.values()].filter((entry) => entry.active && entry.provider);
    await Promise.all(
      active.map(async (connection) => {
        try {
          await db.transaction((u) => u.session(connection.token));
          if (connection.pending.size) {
            const snapshot = await db.sync(connection.session.userId);
            for (const pending of connection.pending.values())
              await resultFor(connection, pending, snapshot.tasks);
          }
        } catch {
          safeClose(connection);
        }
      }),
    );
    if (Date.now() - lastScrub >= 30_000) {
      await db.scrubVoiceTurnText();
      lastScrub = Date.now();
      for (const entry of connections.values()) {
        if (!entry.active && Date.now() - entry.createdAt > 615_000) delete entry.finalText;
        if (!entry.active && Date.now() - entry.createdAt > 86_400_000)
          connections.delete(entry.id);
      }
    }
  };
  await db.scrubVoiceTurnText();
  const timer = setInterval(() => {
    if (polling || stopping) return;
    polling = poll()
      .catch(() => app.log.warn('Voice lifecycle poll failed'))
      .finally(() => {
        polling = undefined;
      });
  }, 250);
  timer.unref();
  // This unencapsulated plugin also observes the previously registered demo-session routes.
  app.addHook('onResponse', async (request, reply) => {
    if (
      request.url.split('?')[0] === '/api/v1/demo-sessions/current' &&
      request.method === 'DELETE' &&
      reply.statusCode === 204 &&
      request.demoSession
    ) {
      await Promise.all(
        [...connections.values()]
          .filter((entry) => entry.session.id === request.demoSession!.id)
          .map(close),
      );
    }
  });
  app.addHook('preClose', async () => {
    stopping = true;
    clearInterval(timer);
    await polling;
    await Promise.all([...connections.values()].map(close));
  });
}

// Fastify's public plugin encapsulation marker; root hooks must see logout routes.
Object.defineProperty(voicePlugin, Symbol.for('skip-override'), { value: true });
export default voicePlugin;
