/** Development-only browser fixtures. Never imported by production builds. */
import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import * as C from '@sb/contracts';
import { buildSeed, defaultRequestPeriod } from '@sb/demo-data';

const seed = buildSeed();
const active = (n: C.Negotiation) =>
  ['AWAITING_OWNER', 'PENDING_PUBLIC', 'OFFERED'].includes(n.status);
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const after = (ms: number) => new Date(Date.now() + ms).toISOString();
const key = 'sb-web-development-fixture-v1';
interface MockState {
  views: Record<string, C.RequestView>;
  quotes: Record<string, C.PricingQuote>;
  tasks: Record<string, C.AgentTaskDetail>;
  payments: Record<string, C.PaymentPreview>;
  events: Record<string, C.SseEvent[]>;
  commands: Record<string, { hash: string; status: number; body: unknown }>;
}
function load(): MockState {
  const raw = localStorage.getItem(key);
  return raw
    ? (JSON.parse(raw) as MockState)
    : { views: {}, quotes: {}, tasks: {}, payments: {}, events: {}, commands: {} };
}
function save(state: MockState) {
  localStorage.setItem(key, JSON.stringify(state));
}
const actor = () => {
  const handle = sessionStorage.getItem('sb-dev-handle');
  const user = seed.users.find((u) => u.handle === handle);
  if (!user) throw new MockError('SESSION_EXPIRED', '데모 아이디로 다시 들어와 주세요.');
  return user;
};
class MockError extends Error {
  constructor(
    readonly code: C.ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
function assert(
  condition: unknown,
  code: C.ErrorCode = 'NOT_FOUND',
  message = '접근할 수 없는 내용입니다.',
): asserts condition {
  if (!condition) throw new MockError(code, message);
}
function meta(): C.Meta {
  return { contractVersion: C.CONTRACT_VERSION, serverTime: now(), traceId: id('trace') };
}
function success<T>(schema: z.ZodType<T>, data: unknown, status = 200) {
  return HttpResponse.json(C.successEnvelopeSchema(schema).parse({ data, meta: meta() }), {
    status,
  });
}
function failure(error: unknown) {
  const fault =
    error instanceof MockError
      ? error
      : new MockError(
          'VALIDATION_ERROR',
          error instanceof z.ZodError
            ? '입력 형식을 확인해 주세요.'
            : '모의 API 상태 확인이 필요합니다.',
        );
  return HttpResponse.json(
    C.ErrorEnvelopeSchema.parse({
      error: { code: fault.code, message: fault.message, retryable: false, details: fault.details },
      meta: meta(),
    }),
    { status: C.ERROR_HTTP_STATUS[fault.code] },
  );
}
function itemSummary(item: C.Item): C.ItemSummary {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    source: item.source,
    image: item.image,
    ownerDisplayName: seed.users.find((u) => u.id === item.ownerId)?.displayName ?? null,
  };
}
function findItem(itemId: string) {
  const item = seed.items.find((item) => item.id === itemId);
  assert(item);
  return item;
}
function ownerCard(view: C.RequestView, branch: C.Negotiation): C.OwnerCard {
  const allowed: C.AllowedAction[] = [];
  if (branch.source === 'RESIDENT' && active(branch)) {
    if (branch.status === 'AWAITING_OWNER') allowed.push('OWNER_APPROVE', 'OWNER_DECLINE');
    if (branch.changeCount < 3) allowed.push('OWNER_COUNTER');
    allowed.push('WITHDRAW_BRANCH');
  }
  return C.OwnerCardSchema.parse({
    requestId: view.request.id,
    requesterDisplayName: seed.users.find((user) => user.id === view.request.requesterId)!
      .displayName,
    negotiation: branch,
    itemSummary: itemSummary(findItem(branch.itemId)),
    allowedActions: allowed,
  });
}
function shape(view: C.RequestView) {
  const status = view.request.status;
  const actions: C.AllowedAction[] = [];
  if (status === 'DRAFT' || status === 'MATCHES_READY') actions.push('EDIT_DRAFT', 'SEARCH');
  if (status === 'MATCHES_READY') actions.push('SUBMIT_CANDIDATES');
  if (status === 'COLLECTING_OFFERS') {
    if (view.negotiations.some((n) => n.status === 'OFFERED')) actions.push('SELECT_OFFER');
    if (
      view.negotiations.some(
        (n) => n.status === 'OFFERED' && n.source === 'RESIDENT' && n.changeCount < 3,
      )
    )
      actions.push('REQUESTER_COUNTER');
    if (view.negotiations.some(active)) actions.push('WITHDRAW_BRANCH');
  }
  if (['DRAFT', 'SEARCHING', 'MATCHES_READY', 'COLLECTING_OFFERS'].includes(status))
    actions.push('CANCEL_REQUEST');
  if (status === 'PAYMENT_PREVIEW_READY') actions.push('OPEN_PAYMENT_PREVIEW');
  view.allowedActions = actions;
  view.comparison = view.negotiations.map((n) => {
    const original = view.candidates.find(
      (candidate) => candidate.itemId === n.itemId,
    )?.suggestedTerms;
    const changedFields: C.ChangedField[] = [];
    if (original?.startAt !== n.terms.startAt) changedFields.push('START_AT');
    if (original?.endAt !== n.terms.endAt) changedFields.push('END_AT');
    if (original?.placeId !== n.terms.placeId) changedFields.push('PLACE');
    if (original?.totalFeeKrw !== n.terms.totalFeeKrw) changedFields.push('TOTAL_FEE');
    return {
      negotiationId: n.id,
      status: n.status,
      itemSummary: itemSummary(findItem(n.itemId)),
      terms: n.terms,
      changedFields,
      validUntil: n.offer?.validUntil ?? null,
      selectable:
        n.status === 'OFFERED' && !!n.offer && Date.parse(n.offer.validUntil) > Date.now(),
      unavailableReason: n.closedReason
        ? C.NEGOTIATION_STATUS_VALUES.includes(n.status)
          ? '이 후보의 요청이 종료되었어요.'
          : n.closedReason
        : null,
    };
  });
  return C.RequestViewSchema.parse(view);
}
function summary(view: C.RequestView): C.RequestSummary {
  const r = view.request;
  return {
    id: r.id,
    status: r.status,
    version: r.version,
    needSummary: {
      category: r.need.category,
      queryText: r.need.queryText,
      startAt: r.need.startAt,
      endAt: r.need.endAt,
    },
    activeBranchCount: view.negotiations.filter(active).length,
    offeredCount: view.negotiations.filter((n) => n.status === 'OFFERED').length,
    selectedNegotiationId: r.selectedNegotiationId,
    updatedAt: r.updatedAt,
  };
}
function emit(
  state: MockState,
  userId: string,
  event: Omit<C.SseEvent, 'eventId' | 'eventVersion' | 'occurredAt'>,
) {
  const events = (state.events[userId] ??= []);
  events.push(
    C.SseEventSchema.parse({
      ...event,
      eventId: String(BigInt(events.at(-1)?.eventId ?? '0') + 1n),
      eventVersion: 1,
      occurredAt: now(),
    }),
  );
}
function touch(state: MockState, view: C.RequestView, branch?: C.Negotiation) {
  view.request.version++;
  view.request.updatedAt = now();
  if (branch) {
    branch.version++;
    branch.updatedAt = now();
  }
  if (view.request.status === 'COLLECTING_OFFERS' && !view.negotiations.some(active))
    view.request.status = 'NO_OFFERS';
  shape(view);
  emit(state, view.request.requesterId, {
    type: 'request.updated',
    requestId: view.request.id,
    requestVersion: view.request.version,
  });
  if (branch?.ownerId)
    emit(state, branch.ownerId, {
      type: 'negotiation.updated',
      negotiationId: branch.id,
      negotiationVersion: branch.version,
      requestId: view.request.id,
    });
}
function settle(state: MockState) {
  let changed = false;
  for (const view of Object.values(state.views)) {
    const request = view.request;
    if (
      !C.TERMINAL_REQUEST_STATUSES.includes(
        request.status as (typeof C.TERMINAL_REQUEST_STATUSES)[number],
      ) &&
      Date.parse(request.expiresAt) <= Date.now()
    ) {
      request.status = 'EXPIRED';
      for (const n of view.negotiations.filter(active)) {
        n.status = 'EXPIRED';
        n.offer = null;
        n.closedReason = 'REQUEST_EXPIRED';
        touch(state, view, n);
      }
      touch(state, view);
      changed = true;
    }
    for (const n of view.negotiations.filter(active)) {
      const deadline = n.status === 'OFFERED' ? n.offer?.validUntil : n.responseDueAt;
      if (deadline && Date.parse(deadline) <= Date.now()) {
        n.status = 'EXPIRED';
        n.offer = null;
        n.closedReason = 'EXPIRED';
        touch(state, view, n);
        changed = true;
      }
    }
  }
  for (const payment of Object.values(state.payments))
    if (
      payment.demoHoldStatus === 'ACTIVE' &&
      Date.parse(payment.demoHoldExpiresAt) <= Date.now()
    ) {
      payment.demoHoldStatus = 'EXPIRED';
      const view = state.views[payment.requestId]!;
      emit(state, view.request.requesterId, {
        type: 'demo_hold.expired',
        requestId: payment.requestId,
        requestVersion: view.request.version,
      });
      changed = true;
    }
  if (changed) save(state);
}
function ownRequest(state: MockState, requestId: string) {
  const view = state.views[requestId];
  assert(view && view.request.requesterId === actor().id);
  return view;
}
function findNegotiation(state: MockState, negotiationId: string) {
  for (const view of Object.values(state.views)) {
    const branch = view.negotiations.find((n) => n.id === negotiationId);
    if (branch) return { view, branch };
  }
  throw new MockError('NOT_FOUND', '요청을 찾을 수 없어요.');
}
function version(actual: number, expected: number) {
  assert(actual === expected, 'VERSION_CONFLICT', '조건이 변경되었어요.');
}
function newQuote(state: MockState, body: C.PriceQuoteBody) {
  const item = findItem(body.itemId);
  const fee = C.computeFeeOptions(item.dailyRateKrw, body.startAt, body.endAt, item.source);
  const quote: C.PricingQuote = {
    id: id('quote'),
    ...body,
    conditionsHash: C.canonicalHash(body),
    billingDays: fee.billingDays,
    baselineKrw: fee.baselineKrw,
    minKrw: fee.minKrw,
    maxKrw: fee.maxKrw,
    recommendedKrw: fee.baselineKrw,
    recommendationSource: item.source === 'PUBLIC' ? 'PUBLIC_FIXED' : 'BASELINE',
    reasonCode: 'BASELINE',
    policyVersion: C.POLICY_VERSION,
    createdAt: now(),
    expiresAt: after(C.TIMING.quoteMs),
  };
  state.quotes[quote.id] = quote;
  return quote;
}
function checkQuote(
  state: MockState,
  terms: C.Terms,
  view: C.RequestView,
  itemId: string,
  negotiationId: string | null,
) {
  const quote = state.quotes[terms.quoteId];
  assert(
    quote && Date.parse(quote.expiresAt) > Date.now(),
    'QUOTE_EXPIRED',
    '가격을 새로 확인해 주세요.',
  );
  assert(
    quote.requestId === view.request.id &&
      quote.itemId === itemId &&
      quote.negotiationId === negotiationId &&
      quote.startAt === terms.startAt &&
      quote.endAt === terms.endAt,
    'VALIDATION_ERROR',
    '가격과 조건이 맞지 않아요.',
  );
  assert(
    terms.totalFeeKrw >= quote.minKrw &&
      terms.totalFeeKrw <= quote.maxKrw &&
      terms.totalFeeKrw % 500 === 0,
    'PRICE_OUT_OF_RANGE',
    '허용 금액 범위를 확인해 주세요.',
  );
  assert(
    findItem(itemId).allowedPlaceIds.includes(terms.placeId),
    'VALIDATION_ERROR',
    '이 물품에서 사용할 수 없는 장소예요.',
  );
}
function offer(view: C.RequestView, branch: C.Negotiation) {
  branch.status = 'OFFERED';
  branch.responseDueAt = null;
  branch.offer = {
    id: id('offer'),
    negotiationId: branch.id,
    termsRevision: branch.termsRevision,
    terms: { ...branch.terms },
    endorsedBy: branch.source === 'PUBLIC' ? 'PUBLIC_DEMO' : 'OWNER',
    createdAt: now(),
    validUntil: new Date(
      Math.min(
        Date.now() + C.TIMING.offerMs,
        Date.parse(view.request.expiresAt),
        Date.parse(branch.terms.startAt),
      ),
    ).toISOString(),
  };
}
function getSession(): C.DemoSessionData {
  return {
    user: actor(),
    csrfToken: 'dev-browser-csrf',
    sessionExpiresAt: after(C.LIMITS.sessionMs),
    demoScenario: 'default',
  };
}
function buildSync(state: MockState): C.SyncData {
  const user = actor();
  const views = Object.values(state.views);
  const ownViews = views.filter((view) => view.request.requesterId === user.id);
  const ownerCards = views.flatMap((view) =>
    view.negotiations.filter((n) => n.ownerId === user.id).map((n) => ownerCard(view, n)),
  );
  const tasks = Object.values(state.tasks)
    .filter((t) => !!t.requestId && state.views[t.requestId]?.request.requesterId === user.id)
    .map(({ result: _result, ...task }) => task);
  return {
    requestSummaries: ownViews.map(summary),
    ownerCards,
    tasks,
    eventCursor: state.events[user.id]?.at(-1)?.eventId ?? '0',
  };
}
function completeSearch(requestId: string) {
  const state = load();
  const view = state.views[requestId];
  if (!view || view.request.status !== 'SEARCHING') return;
  const need = C.ConfirmedNeedSchema.parse(view.request.need);
  const items = seed.items.filter(
    (item) =>
      item.category === need.category &&
      item.ownerId !== view.request.requesterId &&
      C.matchesItem(need.queryText, item),
  );
  view.candidates = items.map((item) => {
    const place = need.preferredPlaceIds.find((place) => item.allowedPlaceIds.includes(place));
    const quote = newQuote(state, {
      requestId,
      negotiationId: null,
      itemId: item.id,
      startAt: need.startAt,
      endAt: need.endAt,
    });
    const blocked =
      !item.enabled ||
      !place ||
      item.unavailableIntervals.some(
        (range) =>
          Date.parse(range.startAt) < Date.parse(need.endAt) &&
          Date.parse(range.endAt) > Date.parse(need.startAt),
      );
    return {
      id: id('candidate'),
      requestId,
      itemId: item.id,
      itemSummary: itemSummary(item),
      quoteId: quote.id,
      suggestedTerms: {
        startAt: need.startAt,
        endAt: need.endAt,
        placeId: place ?? item.allowedPlaceIds[0]!,
        totalFeeKrw: quote.recommendedKrw,
        currency: 'KRW',
        quoteId: quote.id,
      },
      availability: blocked ? 'UNAVAILABLE' : 'AVAILABLE',
      unavailableReason: !item.enabled
        ? '현재 빌릴 수 없는 물품이에요.'
        : !place
          ? '선택한 만남 장소가 맞지 않아요.'
          : blocked
            ? '이 기간에는 이용할 수 없어요.'
            : null,
    };
  });
  view.request.status = view.candidates.some((c) => c.availability === 'AVAILABLE')
    ? 'MATCHES_READY'
    : 'NO_MATCH';
  view.tasks.forEach((task) => {
    if (task.kind === 'SEARCH') {
      task.status = 'SUCCEEDED';
      if (state.tasks[task.id]) state.tasks[task.id]!.status = 'SUCCEEDED';
    }
  });
  touch(state, view);
  save(state);
}
function completePublic(requestId: string) {
  const state = load();
  const view = state.views[requestId];
  if (!view) return;
  for (const branch of view.negotiations.filter((n) => n.status === 'PENDING_PUBLIC')) {
    if (findItem(branch.itemId).publicScenario === 'APPROVE') offer(view, branch);
    else {
      branch.status = 'DECLINED';
      branch.closedReason = 'PUBLIC_DEMO_DECLINED';
    }
    touch(state, view, branch);
  }
  save(state);
}

async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/v1'.length);
  const method = request.method;
  const body: unknown = method === 'GET' || method === 'DELETE' ? undefined : await request.json();
  const state = load();
  settle(state);
  if (path === '/demo-sessions' && method === 'POST') {
    const { handle } = C.DemoSessionBodySchema.parse(body);
    assert(
      seed.users.some((u) => u.handle === handle),
      'UNKNOWN_DEMO_ID',
      '준비된 아이디가 아니에요.',
    );
    sessionStorage.setItem('sb-dev-handle', handle);
    return success(C.DemoSessionDataSchema, getSession(), 201);
  }
  if (path === '/places')
    return success(C.listDataSchema(C.PlaceSchema), { items: seed.places, nextCursor: null });
  if (path.startsWith('/items/')) return success(C.ItemSchema, findItem(path.slice(7)));
  if (path === '/items')
    return success(C.listDataSchema(C.ItemSummarySchema), {
      items: seed.items.map(itemSummary),
      nextCursor: null,
    });
  const user = actor();
  if (path === '/me') return success(C.DemoSessionDataSchema, getSession());
  if (method !== 'GET') {
    assert(
      request.headers.get('X-CSRF-Token') === 'dev-browser-csrf',
      'CSRF_REJECTED',
      '세션을 다시 확인해 주세요.',
    );
    assert(request.headers.get('Idempotency-Key'), 'BAD_REQUEST', '동작 키가 필요합니다.');
  }
  const commandId = `${user.id}:${method}:${path}:${request.headers.get('Idempotency-Key')}`;
  const hash = C.canonicalHash(body ?? null);
  if (method !== 'GET' && state.commands[commandId]) {
    const prior = state.commands[commandId]!;
    assert(
      prior.hash === hash,
      'IDEMPOTENCY_KEY_REUSED',
      '다른 내용으로 같은 키를 사용할 수 없어요.',
    );
    return prior.status === 204
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json(prior.body as never, { status: prior.status });
  }
  let response: Response;
  if (path === '/demo-sessions/current' && method === 'DELETE') {
    sessionStorage.removeItem('sb-dev-handle');
    response = new HttpResponse(null, { status: 204 });
  } else if (path === '/sync') return success(C.SyncDataSchema, buildSync(state));
  else if (path === '/inbox') {
    const snapshot = buildSync(state);
    return url.searchParams.get('role') === 'OWNER'
      ? success(C.listDataSchema(C.OwnerCardSchema), {
          items: snapshot.ownerCards,
          nextCursor: null,
        })
      : success(C.listDataSchema(C.RequestSummarySchema), {
          items: snapshot.requestSummaries,
          nextCursor: null,
        });
  } else if (path === '/requests' && method === 'POST') {
    const { need } = C.CreateRequestBodySchema.parse(body);
    const requestId = id('req');
    const view: C.RequestView = {
      request: {
        id: requestId,
        requesterId: user.id,
        version: 1,
        needRevision: 1,
        status: 'DRAFT',
        need,
        createdAt: now(),
        updatedAt: now(),
        expiresAt: after(C.TIMING.rootMs),
        selectedNegotiationId: null,
      },
      candidates: [],
      negotiations: [],
      comparison: [],
      tasks: [],
      allowedActions: [],
    };
    state.views[requestId] = view;
    emit(state, user.id, { type: 'request.updated', requestId, requestVersion: 1 });
    response = success(C.RequestViewSchema, shape(view), 201);
  } else if (path === '/agent-turns' && method === 'POST') {
    const input = C.AgentTurnBodySchema.parse(body);
    const view = ownRequest(state, input.requestId);
    version(view.request.version, input.expectedRequestVersion);
    assert(view.request.status === 'DRAFT', 'INVALID_STATE', '초안에서만 요약할 수 있어요.');
    const category = /청소/.test(input.text)
      ? 'CLEANING'
      : /공구|사다리/.test(input.text)
        ? 'TOOLS'
        : /가방|여행/.test(input.text)
          ? 'TRAVEL'
          : 'HOBBY';
    const proposedNeed: C.NeedDraft = {
      category,
      queryText:
        category === 'HOBBY'
          ? '프로젝터'
          : category === 'CLEANING'
            ? '청소기'
            : category === 'TRAVEL'
              ? '여행 가방'
              : '공구',
      ...defaultRequestPeriod(),
      preferredPlaceIds: ['place-center', 'place-library'],
      maxBudgetKrw: null,
    };
    const task: C.AgentTaskDetail = {
      id: id('task'),
      kind: 'EXTRACT_NEED',
      requestId: view.request.id,
      negotiationId: null,
      inputVersion: { kind: 'NEED', needRevision: view.request.needRevision, turnId: id('turn') },
      status: 'SUCCEEDED',
      attempt: 1,
      errorCode: null,
      result: {
        proposedNeed,
        missingFields: [],
        clarificationQuestion: '개발용 고정 요약입니다. 날짜와 장소를 직접 확인해 주세요.',
      },
    };
    state.tasks[task.id] = task;
    emit(state, user.id, {
      type: 'agent.task.updated',
      taskId: task.id,
      requestId: view.request.id,
    });
    response = success(C.TaskAcceptedDataSchema, { taskId: task.id }, 202);
  } else if (path.startsWith('/tasks/') && method === 'GET') {
    const task = state.tasks[path.slice(7)];
    assert(task?.requestId && state.views[task.requestId]?.request.requesterId === user.id);
    return success(C.AgentTaskDetailSchema, task);
  } else if (path === '/price-quotes' && method === 'POST') {
    const input = C.PriceQuoteBodySchema.parse(body);
    const view = state.views[input.requestId];
    assert(view);
    if (input.negotiationId) {
      const { branch } = findNegotiation(state, input.negotiationId);
      assert(
        branch.requestId === input.requestId &&
          branch.itemId === input.itemId &&
          (branch.ownerId === user.id || view.request.requesterId === user.id),
      );
      assert(active(branch), 'INVALID_STATE', '종료된 조건이에요.');
    } else {
      assert(view.request.requesterId === user.id);
      assert(
        view.request.status === 'MATCHES_READY' &&
          view.candidates.some((c) => c.itemId === input.itemId),
        'INVALID_STATE',
        '후보 상태를 확인해 주세요.',
      );
    }
    response = success(C.PricingQuoteSchema, newQuote(state, input));
  } else if (path.startsWith('/requests/')) {
    const [, , requestId = '', command] = path.split('/');
    const view = ownRequest(state, requestId);
    if (method === 'GET' && !command) return success(C.RequestViewSchema, shape(view));
    if (method === 'GET' && command === 'candidates')
      return success(C.listDataSchema(C.CandidateSchema), {
        items: view.candidates,
        nextCursor: null,
      });
    if (method === 'GET' && command === 'payment-preview') {
      assert(state.payments[requestId]);
      return success(C.PaymentPreviewSchema, state.payments[requestId]);
    }
    if (command === 'draft' && method === 'PATCH') {
      const input = C.PatchDraftBodySchema.parse(body);
      version(view.request.version, input.expectedRequestVersion);
      assert(
        ['DRAFT', 'MATCHES_READY'].includes(view.request.status),
        'INVALID_STATE',
        '초안을 수정할 수 없어요.',
      );
      view.request.need = input.need;
      view.request.needRevision++;
      view.request.status = 'DRAFT';
      view.candidates = [];
      touch(state, view);
      response = success(C.RequestViewSchema, shape(view));
    } else if (command === 'search' && method === 'POST') {
      const input = C.SearchRequestBodySchema.parse(body);
      version(view.request.version, input.expectedRequestVersion);
      assert(view.request.status === 'DRAFT', 'INVALID_STATE', '초안부터 확인해 주세요.');
      C.ConfirmedNeedSchema.parse(view.request.need);
      view.request.status = 'SEARCHING';
      const task: C.AgentTask = {
        id: id('task'),
        kind: 'SEARCH',
        requestId,
        negotiationId: null,
        inputVersion: { kind: 'NEED', needRevision: view.request.needRevision },
        status: 'RUNNING',
        attempt: 1,
        errorCode: null,
      };
      view.tasks.push(task);
      state.tasks[task.id] = { ...task, result: null };
      touch(state, view);
      response = success(
        C.SearchAcceptedDataSchema,
        { request: shape(view), taskId: task.id },
        202,
      );
      setTimeout(() => completeSearch(requestId), 650);
    } else if (command === 'submit' && method === 'POST') {
      const input = C.SubmitRequestBodySchema.parse(body);
      version(view.request.version, input.expectedRequestVersion);
      assert(
        view.request.status === 'MATCHES_READY',
        'INVALID_STATE',
        '후보 상태를 확인해 주세요.',
      );
      for (const selection of input.selections) {
        const candidate = view.candidates.find((c) => c.id === selection.candidateId);
        assert(
          candidate?.availability === 'AVAILABLE',
          'AVAILABILITY_CONFLICT',
          '선택할 수 없는 후보예요.',
        );
        checkQuote(
          state,
          {
            ...candidate.suggestedTerms,
            quoteId: selection.quoteId,
            totalFeeKrw: selection.totalFeeKrw,
          },
          view,
          candidate.itemId,
          null,
        );
      }
      view.request.status = 'COLLECTING_OFFERS';
      for (const selection of input.selections) {
        const candidate = view.candidates.find((c) => c.id === selection.candidateId)!;
        const item = findItem(candidate.itemId);
        const branch: C.Negotiation = {
          id: id('neg'),
          requestId,
          itemId: item.id,
          ownerId: item.ownerId,
          source: item.source,
          version: 1,
          status: item.source === 'PUBLIC' ? 'PENDING_PUBLIC' : 'AWAITING_OWNER',
          termsRevision: 1,
          terms: {
            ...candidate.suggestedTerms,
            quoteId: selection.quoteId,
            totalFeeKrw: selection.totalFeeKrw,
          },
          changeCount: 0,
          responseDueAt: new Date(
            Math.min(
              Date.parse(view.request.expiresAt),
              Date.parse(candidate.suggestedTerms.startAt),
            ),
          ).toISOString(),
          offer: null,
          closedReason: null,
          updatedAt: now(),
        };
        view.negotiations.push(branch);
        if (item.ownerId)
          emit(state, item.ownerId, {
            type: 'negotiation.created',
            requestId,
            negotiationId: branch.id,
            negotiationVersion: 1,
          });
      }
      touch(state, view);
      response = success(C.RequestViewSchema, shape(view), 201);
      setTimeout(() => completePublic(requestId), 1200);
    } else if (command === 'select' && method === 'POST') {
      const input = C.SelectOfferBodySchema.parse(body);
      version(view.request.version, input.expectedRequestVersion);
      assert(
        view.request.status === 'COLLECTING_OFFERS',
        'INVALID_STATE',
        '제안 상태가 변경되었어요.',
      );
      const branch = view.negotiations.find((n) => n.id === input.negotiationId);
      assert(branch);
      version(branch.version, input.expectedNegotiationVersion);
      assert(
        branch.status === 'OFFERED' &&
          branch.offer &&
          branch.offer.id === input.offerId &&
          branch.termsRevision === input.termsRevision,
        'VERSION_CONFLICT',
        '조건을 다시 확인해 주세요.',
      );
      assert(
        Date.parse(branch.offer.validUntil) > Date.now(),
        'OFFER_EXPIRED',
        '제안이 만료되었어요.',
      );
      assert(
        !Object.values(state.payments).some(
          (p) =>
            p.itemSummary.id === branch.itemId &&
            p.demoHoldStatus === 'ACTIVE' &&
            Date.parse(p.terms.startAt) < Date.parse(branch.terms.endAt) &&
            Date.parse(p.terms.endAt) > Date.parse(branch.terms.startAt),
        ),
        'AVAILABILITY_CONFLICT',
        '다른 데모 선택이 있어요.',
      );
      view.request.status = 'PAYMENT_PREVIEW_READY';
      view.request.selectedNegotiationId = branch.id;
      branch.status = 'SELECTED';
      touch(state, view, branch);
      for (const other of view.negotiations.filter((n) => n.id !== branch.id && active(n))) {
        other.status = 'SUPERSEDED';
        other.closedReason = 'OTHER_SELECTED';
        other.offer = null;
        touch(state, view, other);
      }
      const payment: C.PaymentPreview = {
        mode: 'PREVIEW_ONLY',
        requestId,
        negotiationId: branch.id,
        offerId: branch.offer.id,
        termsRevision: branch.termsRevision,
        totalFeeKrw: branch.terms.totalFeeKrw,
        currency: 'KRW',
        chargeable: false,
        paymentStatus: 'NOT_APPLICABLE',
        demoHoldStatus: 'ACTIVE',
        demoHoldExpiresAt: after(C.TIMING.holdMs),
        notice: '실제 결제와 예약이 이루어지지 않습니다',
        itemSummary: itemSummary(findItem(branch.itemId)),
        terms: { ...branch.terms },
      };
      state.payments[requestId] = payment;
      response = success(C.SelectOfferDataSchema, {
        request: shape(view),
        paymentPreview: payment,
      });
    } else if (command === 'cancel' && method === 'POST') {
      const input = C.CancelRequestBodySchema.parse(body);
      version(view.request.version, input.expectedRequestVersion);
      assert(
        view.allowedActions.includes('CANCEL_REQUEST'),
        'INVALID_STATE',
        '취소할 수 없는 상태예요.',
      );
      view.request.status = 'CANCELLED';
      for (const branch of view.negotiations.filter(active)) {
        branch.status = 'WITHDRAWN';
        branch.offer = null;
        branch.closedReason = 'REQUEST_CANCELLED';
        touch(state, view, branch);
      }
      touch(state, view);
      response = success(C.RequestViewSchema, shape(view));
    } else throw new MockError('NOT_FOUND', '화면에서 지원하지 않는 요청이에요.');
  } else if (path.startsWith('/negotiations/')) {
    const [, , negotiationId = '', command] = path.split('/');
    const { view, branch } = findNegotiation(state, negotiationId);
    const owner = branch.ownerId === user.id;
    assert(owner || view.request.requesterId === user.id);
    if (method === 'GET')
      return owner
        ? success(C.OwnerCardSchema, ownerCard(view, branch))
        : success(C.NegotiationSchema, branch);
    assert(active(branch), 'INVALID_STATE', '이미 종료된 요청이에요.');
    if (command === 'owner-response') {
      assert(owner && branch.source === 'RESIDENT');
      const input = C.OwnerResponseBodySchema.parse(body);
      version(branch.version, input.expectedNegotiationVersion);
      version(branch.termsRevision, input.expectedTermsRevision);
      if (input.action === 'APPROVE') {
        assert(branch.status === 'AWAITING_OWNER', 'INVALID_STATE', '이미 응답한 조건이에요.');
        offer(view, branch);
      } else if (input.action === 'DECLINE') {
        assert(branch.status === 'AWAITING_OWNER', 'INVALID_STATE', '이미 응답한 조건이에요.');
        branch.status = 'DECLINED';
        branch.closedReason = input.reasonCode;
        branch.offer = null;
      } else {
        assert(branch.changeCount < 3, 'CHANGE_LIMIT_REACHED', '변경 한도에 도달했어요.');
        checkQuote(state, input.terms, view, branch.itemId, branch.id);
        assert(
          ['startAt', 'endAt', 'placeId', 'totalFeeKrw'].some(
            (field) => branch.terms[field as keyof C.Terms] !== input.terms[field as keyof C.Terms],
          ),
          'NO_CHANGES',
          '변경한 조건이 없어요.',
        );
        branch.terms = input.terms;
        branch.termsRevision++;
        branch.changeCount++;
        offer(view, branch);
      }
      touch(state, view, branch);
      response = success(C.OwnerCardSchema, ownerCard(view, branch));
    } else if (command === 'requester-counter') {
      assert(!owner && view.request.requesterId === user.id && branch.source === 'RESIDENT');
      const input = C.RequesterCounterBodySchema.parse(body);
      version(branch.version, input.expectedNegotiationVersion);
      version(branch.termsRevision, input.expectedTermsRevision);
      assert(branch.status === 'OFFERED', 'INVALID_STATE', '도착한 제안에서만 변경할 수 있어요.');
      assert(branch.changeCount < 3, 'CHANGE_LIMIT_REACHED', '변경 한도에 도달했어요.');
      checkQuote(state, input.terms, view, branch.itemId, branch.id);
      assert(
        ['startAt', 'endAt', 'placeId', 'totalFeeKrw'].some(
          (field) => branch.terms[field as keyof C.Terms] !== input.terms[field as keyof C.Terms],
        ),
        'NO_CHANGES',
        '변경한 조건이 없어요.',
      );
      branch.terms = input.terms;
      branch.termsRevision++;
      branch.changeCount++;
      branch.offer = null;
      branch.status = 'AWAITING_OWNER';
      branch.responseDueAt = view.request.expiresAt;
      touch(state, view, branch);
      response = success(C.RequestViewSchema, shape(view));
    } else if (command === 'withdraw') {
      const input = C.WithdrawBodySchema.parse(body);
      version(branch.version, input.expectedNegotiationVersion);
      branch.status = 'WITHDRAWN';
      branch.closedReason = 'USER_WITHDRAWN';
      branch.offer = null;
      touch(state, view, branch);
      response = owner
        ? success(C.OwnerCardSchema, ownerCard(view, branch))
        : success(C.RequestViewSchema, shape(view));
    } else throw new MockError('NOT_FOUND', '지원하지 않는 명령이에요.');
  } else if (path === '/voice-sessions')
    throw new MockError(
      'AI_UNAVAILABLE',
      '개발용 모의 API에서는 실제 음성 연결을 만들지 않습니다. 텍스트로 입력해 주세요.',
    );
  else throw new MockError('NOT_FOUND', '내용을 찾을 수 없어요.');
  if (method !== 'GET')
    state.commands[commandId] = {
      hash,
      status: response.status,
      body: response.status === 204 ? null : await response.clone().json(),
    };
  save(state);
  return response;
}

// Serialize fixture writes because three candidate quote requests arrive together.
// Production mutations are independently transactional in the real API/database.
let mutations: Promise<unknown> = Promise.resolve();
export const handlers = [
  http.get('/api/v1/events', ({ request }) => {
    try {
      const user = actor();
      const url = new URL(request.url);
      let cursor = BigInt(url.searchParams.get('after') ?? '0');
      let timer: ReturnType<typeof setInterval>;
      let heartbeat: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encode = (text: string) => {
            try {
              controller.enqueue(new TextEncoder().encode(text));
            } catch {
              clearInterval(timer);
              clearInterval(heartbeat);
            }
          };
          encode(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: now() })}\n\n`);
          timer = setInterval(() => {
            const state = load();
            settle(state);
            for (const event of state.events[user.id] ?? [])
              if (BigInt(event.eventId) > cursor) {
                cursor = BigInt(event.eventId);
                encode(
                  `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );
              }
          }, 500);
          heartbeat = setInterval(
            () => encode(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: now() })}\n\n`),
            15000,
          );
          request.signal.addEventListener(
            'abort',
            () => {
              clearInterval(timer);
              clearInterval(heartbeat);
              try {
                controller.close();
              } catch {}
            },
            { once: true },
          );
        },
        cancel() {
          clearInterval(timer);
          clearInterval(heartbeat);
        },
      });
      return new HttpResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      return failure(error);
    }
  }),
  http.all('/api/v1/*', async ({ request }) => {
    const execute = async () => {
      try {
        return await dispatch(request);
      } catch (error) {
        return failure(error);
      }
    };
    if (request.method === 'GET') return execute();
    const next = mutations.then(execute, execute);
    mutations = next;
    return next;
  }),
];
