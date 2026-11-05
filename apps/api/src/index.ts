import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import * as C from '@sb/contracts';
import {
  Database,
  DomainError,
  fail,
  id,
  all,
  sameToken,
  type Session,
  type Commands,
  type StoredResponse,
} from '@sb/db';
import { registerEvents } from './sse.js';
export type ApiOptions = {
  db?: Database;
  appOrigin?: string;
  cookieName?: string;
  cookieSecure?: boolean;
  logger?: boolean;
  rateLimitMax?: number;
  heartbeatMs?: number;
};
type MutationHandler = (u: Commands, request: FastifyRequest) => Promise<unknown>;
export interface ApiContext {
  db: Database;
  cookieName: string;
  envelope: (data: unknown) => { data: unknown; meta: C.Meta };
  requireSession: (request: FastifyRequest) => Session;
  mutation: (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    status: number,
    handler: MutationHandler,
  ) => void;
}
declare module 'fastify' {
  interface FastifyRequest {
    demoSession: Session | null;
  }
  interface FastifyInstance {
    demo: ApiContext;
  }
}
export function errorResponse(error: unknown, meta: C.Meta): StoredResponse {
  if (error instanceof DomainError)
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: ['TEMPORARILY_UNAVAILABLE', 'AI_UNAVAILABLE', 'RATE_LIMITED'].includes(
            error.code,
          ),
          details: error.details,
        },
        meta,
      },
    };
  if (error instanceof z.ZodError)
    return {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: '입력 조건을 확인해 주세요.',
          retryable: false,
          details: { fields: error.issues.map((i) => i.path.join('.')) },
        },
        meta,
      },
    };
  const statusCode = (error as { statusCode?: number })?.statusCode;
  if (statusCode === 400 || statusCode === 413)
    return {
      status: 400,
      body: {
        error: {
          code: 'BAD_REQUEST',
          message: '요청 형식을 확인해 주세요.',
          retryable: false,
          details: {},
        },
        meta,
      },
    };
  if (statusCode === 429)
    return {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: '잠시 후 다시 시도해 주세요.',
          retryable: true,
          details: {},
        },
        meta,
      },
    };
  return {
    status: 503,
    body: {
      error: {
        code: 'TEMPORARILY_UNAVAILABLE',
        message: '일시적으로 요청을 처리할 수 없습니다.',
        retryable: true,
        details: {},
      },
      meta,
    },
  };
}
export function paginate<T>(
  items: T[],
  query: { cursor?: string | undefined; limit: number },
  key: (v: T) => string,
  scope: string,
): C.ListData<T> {
  const sorted = [...items].sort((a, b) => key(a).localeCompare(key(b)));
  let after = '';
  if (query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as {
        key: string;
        scope: string;
      };
      if (decoded.scope !== scope || typeof decoded.key !== 'string') fail('BAD_REQUEST');
      after = decoded.key;
    } catch {
      fail('BAD_REQUEST');
    }
  }
  const available = sorted.filter((v) => key(v) > after);
  const page = available.slice(0, query.limit);
  return {
    items: page,
    nextCursor:
      available.length > query.limit
        ? Buffer.from(JSON.stringify({ key: key(page.at(-1)!), scope })).toString('base64url')
        : null,
  };
}
export async function buildApi(options: ApiOptions = {}): Promise<FastifyInstance> {
  const db = options.db ?? new Database();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 150_000, trustProxy: false });
  const appOrigins = new Set(
    (
      options.appOrigin ??
      (process.env.APP_ORIGINS?.trim() || process.env.APP_ORIGIN || 'http://localhost:8000')
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const cookieName = options.cookieName ?? process.env.COOKIE_NAME ?? 'demo_session';
  const cookieSecure = options.cookieSecure ?? false;
  const meta = (): C.Meta => ({
    contractVersion: C.CONTRACT_VERSION,
    serverTime: db.now().toISOString(),
    traceId: id('trace'),
  });
  const envelope = (data: unknown) => ({ data, meta: meta() });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429 }),
  });
  app.decorateRequest('demoSession', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      if (!request.headers.origin || !appOrigins.has(request.headers.origin)) fail('CSRF_REJECTED');
    }
    const path = request.url.split('?')[0]!;
    const publicRoute =
      (path === '/api/v1/demo-sessions' && request.method === 'POST') ||
      (request.method === 'GET' &&
        (path === '/api/v1/places' ||
          path === '/api/v1/items' ||
          path.startsWith('/api/v1/items/')));
    if (path.startsWith('/api/v1/') && !publicRoute) {
      request.demoSession = await db.transaction((u) => u.session(request.cookies[cookieName]));
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !sameToken(csrf, request.demoSession.csrfToken))
          fail('CSRF_REJECTED');
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !key.trim() || key.length > 200) fail('BAD_REQUEST');
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const response = errorResponse(error, meta());
    if (response.status === 503)
      request.log.error({ code: (error as { code?: string }).code }, 'Request failed');
    reply.code(response.status).send(response.body);
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(errorResponse(new DomainError('NOT_FOUND'), meta()).body),
  );
  const requireSession = (request: FastifyRequest) =>
    request.demoSession ?? fail('SESSION_EXPIRED');
  const mutation = (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    status: number,
    handler: MutationHandler,
  ) => {
    app.route({
      method,
      url: `/api/v1${path}`,
      handler: async (request, reply) => {
        const session = requireSession(request);
        const result = await db.idempotent(
          {
            session,
            method,
            path: request.url.split('?')[0]!,
            key: request.headers['idempotency-key'] as string,
            body: request.body ?? null,
          },
          async (u) => {
            try {
              const data = await handler(u, request);
              return { status, body: status === 204 ? null : envelope(data) };
            } catch (e) {
              if (e instanceof DomainError || e instanceof z.ZodError)
                return errorResponse(e, meta());
              throw e;
            }
          },
        );
        if (status === 204 && path === '/demo-sessions/current' && result.status === 204)
          reply.clearCookie(cookieName, {
            path: '/',
            secure: cookieSecure,
            httpOnly: true,
            sameSite: 'lax',
          });
        return reply.code(result.status).send(result.status === 204 ? undefined : result.body);
      },
    });
  };
  app.decorate('demo', { db, cookieName, envelope, requireSession, mutation });
  const param = (request: FastifyRequest) =>
    C.IdSchema.parse((request.params as { id: string }).id);
  const get = (path: string, fn: (request: FastifyRequest) => Promise<unknown>) =>
    app.get(`/api/v1${path}`, async (request) => envelope(await fn(request)));
  app.post(
    '/api/v1/demo-sessions',
    { config: { rateLimit: { max: options.rateLimitMax ?? 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = C.DemoSessionBodySchema.parse(request.body);
      const result = await db.transaction((u) =>
        u.createSession(body.handle, request.cookies[cookieName]),
      );
      reply.setCookie(cookieName, result.token, {
        path: '/',
        secure: cookieSecure,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60,
        expires: new Date(result.data.sessionExpiresAt),
      });
      return reply.code(201).send(envelope(result.data));
    },
  );
  get('/me', (request) => db.transaction((u) => u.sessionData(requireSession(request))));
  mutation('DELETE', '/demo-sessions/current', 204, async (u, req) => {
    if (req.body !== undefined && req.body !== null) z.object({}).strict().parse(req.body);
    const s = requireSession(req);
    await u.revokeSession(s.id, s.userId);
  });
  get('/places', async (request) => {
    const q = C.PaginationQuerySchema.parse(request.query);
    return db.transaction(async (u) => paginate(await u.places(), q, (v) => v.id, 'places'));
  });
  get('/items', async (request) => {
    const q = C.ItemsQuerySchema.parse(request.query);
    return db.transaction(async (u) => {
      const items = await all<C.Item>(u.c, 'items');
      const filtered = items.filter(
        (i) => (!q.category || i.category === q.category) && (!q.source || i.source === q.source),
      );
      const summaries: C.ItemSummary[] = [];
      for (const item of filtered) summaries.push(await u.itemSummary(item));
      return paginate(summaries, q, (v) => v.id, `items:${q.category ?? ''}:${q.source ?? ''}`);
    });
  });
  get('/items/:id', (request) => db.transaction((u) => u.item(param(request))));
  mutation('POST', '/requests', 201, (u, req) =>
    u.create(requireSession(req).userId, C.CreateRequestBodySchema.parse(req.body).need),
  );
  mutation('PATCH', '/requests/:id/draft', 200, (u, req) =>
    u.patchDraft(requireSession(req).userId, param(req), C.PatchDraftBodySchema.parse(req.body)),
  );
  mutation('POST', '/requests/:id/search', 202, (u, req) =>
    u.confirmAndSearch(
      requireSession(req).userId,
      param(req),
      C.SearchRequestBodySchema.parse(req.body).expectedRequestVersion,
    ),
  );
  get('/requests/:id', (req) =>
    db.transaction((u) => u.getRequest(requireSession(req).userId, param(req))),
  );
  get('/requests/:id/candidates', async (req) => {
    const q = C.PaginationQuerySchema.parse(req.query);
    const view = await db.transaction((u) => u.getRequest(requireSession(req).userId, param(req)));
    return paginate(view.candidates, q, (v) => v.id, `candidates:${param(req)}`);
  });
  mutation('POST', '/requests/:id/submit', 201, (u, req) =>
    u.submit(requireSession(req).userId, param(req), C.SubmitRequestBodySchema.parse(req.body)),
  );
  mutation('POST', '/requests/:id/cancel', 200, (u, req) =>
    u.cancel(
      requireSession(req).userId,
      param(req),
      C.CancelRequestBodySchema.parse(req.body).expectedRequestVersion,
    ),
  );
  mutation('POST', '/price-quotes', 200, (u, req) =>
    u.issueQuote(
      requireSession(req).userId,
      C.PriceQuoteBodySchema.parse(req.body),
      db.feeRecommender,
    ),
  );
  get('/negotiations/:id', (req) =>
    db.transaction((u) => u.getNegotiation(requireSession(req).userId, param(req))),
  );
  mutation('POST', '/negotiations/:id/owner-response', 200, (u, req) =>
    u.ownerResponse(
      requireSession(req).userId,
      param(req),
      C.OwnerResponseBodySchema.parse(req.body),
    ),
  );
  mutation('POST', '/negotiations/:id/requester-counter', 200, (u, req) =>
    u.requesterCounter(
      requireSession(req).userId,
      param(req),
      C.RequesterCounterBodySchema.parse(req.body),
    ),
  );
  mutation('POST', '/negotiations/:id/withdraw', 200, (u, req) =>
    u.withdraw(
      requireSession(req).userId,
      param(req),
      C.WithdrawBodySchema.parse(req.body).expectedNegotiationVersion,
    ),
  );
  mutation('POST', '/requests/:id/select', 200, (u, req) =>
    u.select(requireSession(req).userId, param(req), C.SelectOfferBodySchema.parse(req.body)),
  );
  get('/requests/:id/payment-preview', (req) =>
    db.transaction((u) => u.paymentPreview(requireSession(req).userId, param(req))),
  );
  get('/inbox', async (req) => {
    const q = C.InboxQuerySchema.parse(req.query);
    const s = await db.sync(requireSession(req).userId);
    return q.role === 'REQUESTER'
      ? paginate(
          s.requestSummaries,
          q,
          (v) => v.id,
          `inbox:${requireSession(req).userId}:REQUESTER`,
        )
      : paginate(
          s.ownerCards,
          q,
          (v) => v.negotiation.id,
          `inbox:${requireSession(req).userId}:OWNER`,
        );
  });
  get('/sync', (req) => db.sync(requireSession(req).userId));
  mutation('POST', '/agent-turns', 202, (u, req) =>
    u.agentTurn(requireSession(req).userId, C.AgentTurnBodySchema.parse(req.body)),
  );
  get('/tasks/:id', (req) => db.getTask(param(req), requireSession(req).userId));
  await registerEvents(app, options.heartbeatMs ?? 15_000);
  const voiceUrl = new URL('./voice/index.ts', import.meta.url);
  if (existsSync(voiceUrl)) {
    const plugin = (await import(voiceUrl.href)) as {
      default?: Parameters<FastifyInstance['register']>[0];
      voicePlugin?: Parameters<FastifyInstance['register']>[0];
    };
    const register = plugin.default ?? plugin.voicePlugin;
    if (register) await app.register(register);
  }
  await app.register((await import('./listings/index.js')).default);
  await app.register((await import('./intake-approvals/index.js')).default);
  // 3번 탐색·예약·대기·알림(명세 0004)
  await app.register((await import('./reservations/index.js')).default);
  if (!options.db) app.addHook('onClose', async () => db.close());
  return app;
}
export { buildApi as createApp };
