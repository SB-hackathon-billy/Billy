import type { PoolClient } from 'pg';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ACTIVE_NEGOTIATION_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  LIMITS,
  TIMING,
  canonicalHash,
  ConfirmedNeedSchema,
  type RentalRequest,
  type Negotiation,
  type Item,
  type DemoUser,
  type Place,
  type Terms,
  type RequestView,
  type OwnerCard,
  type RequestSummary,
  type ItemSummary,
  type ComparisonRow,
  type AllowedAction,
  type SseEvent,
  type AgentTask,
  type InputVersion,
  type AgentTaskKind,
  type DemoSessionData,
  type DemoScenario,
  type PaymentPreview,
  type ChangedField,
} from '@sb/contracts';
import { type SeedTiming } from '@sb/demo-data';
import { all, read, put, fail, id } from './storage.js';
export type Session = {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
  user: DemoUser;
};
export const active = (n: Negotiation) =>
  (ACTIVE_NEGOTIATION_STATUSES as readonly string[]).includes(n.status);
export const terminal = (r: RentalRequest) =>
  (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status);
export const hashToken = (s: string) => createHash('sha256').update(s).digest('hex');
export function sameToken(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export type PendingEvent = {
  userId: string;
  event: Omit<SseEvent, 'eventId' | 'eventVersion' | 'occurredAt'>;
};
export class Unit {
  readonly events: PendingEvent[] = [];
  constructor(
    readonly c: PoolClient,
    readonly now: Date,
    readonly clock: () => Date = () => now,
  ) {}
  refreshClock() {
    this.now.setTime(this.clock().getTime());
  }
  get iso() {
    return this.now.toISOString();
  }
  async config(): Promise<{ name: DemoScenario; timing: SeedTiming }> {
    return (
      (await this.c.query('SELECT data FROM app_config')).rows[0]?.data ?? {
        name: 'default',
        timing: TIMING,
      }
    );
  }
  async user(userId: string): Promise<DemoUser> {
    return (await read<DemoUser>(this.c, 'users', userId)) ?? fail('NOT_FOUND');
  }
  async item(itemId: string): Promise<Item> {
    return (await read<Item>(this.c, 'items', itemId)) ?? fail('NOT_FOUND');
  }
  async places() {
    return all<Place>(this.c, 'places', 'ORDER BY id');
  }
  async itemSummary(item: Item): Promise<ItemSummary> {
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      category: item.category,
      image: item.image,
      ownerDisplayName: item.ownerId ? (await this.user(item.ownerId)).displayName : null,
    };
  }
  async lockRequest(
    requestId: string,
    actor?: string,
    ownerAllowed = false,
  ): Promise<RentalRequest> {
    const r = (
      await this.c.query('SELECT data FROM rental_requests WHERE id=$1 FOR UPDATE', [requestId])
    ).rows[0]?.data as RentalRequest | undefined;
    this.refreshClock();
    if (!r) fail('NOT_FOUND');
    if (actor && r.requesterId !== actor) {
      if (
        !ownerAllowed ||
        !(
          await this.c.query('SELECT 1 FROM negotiations WHERE request_id=$1 AND owner_id=$2', [
            requestId,
            actor,
          ])
        ).rowCount
      )
        fail('NOT_FOUND');
    }
    return r;
  }
  async lockNegotiations(requestId: string): Promise<Negotiation[]> {
    return all(this.c, 'negotiations', 'WHERE request_id=$1 ORDER BY id FOR UPDATE', [requestId]);
  }
  async lockItems(itemIds: string[]): Promise<void> {
    if (itemIds.length)
      await this.c.query('SELECT id FROM items WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [
        [...new Set(itemIds)].sort(),
      ]);
    this.refreshClock();
  }
  async negotiationRoot(
    negotiationId: string,
    actor: string,
    role: 'OWNER' | 'REQUESTER' | 'EITHER' = 'EITHER',
  ) {
    const n = await read<Negotiation>(this.c, 'negotiations', negotiationId);
    if (!n) fail('NOT_FOUND');
    const r = await this.lockRequest(n.requestId);
    if (
      role === 'OWNER'
        ? n.ownerId !== actor || n.source !== 'RESIDENT'
        : role === 'REQUESTER'
          ? r.requesterId !== actor
          : n.ownerId !== actor && r.requesterId !== actor
    )
      fail('NOT_FOUND');
    const ns = await this.lockNegotiations(r.id);
    const current = ns.find((v) => v.id === n.id)!;
    await this.expire(r, ns);
    return { r, ns, n: current };
  }
  event(userId: string, event: PendingEvent['event']) {
    this.events.push({ userId, event });
  }
  async flush() {
    const users = [...new Set(this.events.map((e) => e.userId))].sort();
    if (users.length)
      // Only event_cursor changes. Keep FK KEY SHARE locks from concurrent request/session
      // inserts compatible while serializing cursor updates in recipient order.
      await this.c.query(
        'SELECT id FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE',
        [users],
      );
    for (const e of this.events) {
      const result = await this.c.query(
        'UPDATE users SET event_cursor=event_cursor+1 WHERE id=$1 RETURNING event_cursor::text',
        [e.userId],
      );
      const data: SseEvent = {
        ...e.event,
        eventId: result.rows[0].event_cursor,
        eventVersion: 1,
        occurredAt: this.iso,
      };
      await this.c.query(
        'INSERT INTO user_events(user_id,cursor,data,occurred_at) VALUES($1,$2,$3,$4)',
        [e.userId, data.eventId, data, this.iso],
      );
      await this.c.query("INSERT INTO outbox(kind,payload,created_at) VALUES('EVENT',$1,$2)", [
        { userId: e.userId, eventId: data.eventId },
        this.iso,
      ]);
    }
    if (users.length)
      await this.c.query("SELECT pg_notify('sb_events',$1)", [JSON.stringify(users)]);
    this.events.length = 0;
  }
  async changed(r: RentalRequest, ns: Negotiation[], reason: string, created = false) {
    r.version++;
    r.updatedAt = this.iso;
    await put(this.c, 'rental_requests', r);
    this.event(r.requesterId, {
      type: 'request.updated',
      requestId: r.id,
      requestVersion: r.version,
      reason,
    });
    for (const n of ns) {
      n.version += created ? 0 : 1;
      n.updatedAt = this.iso;
      await put(this.c, 'negotiations', n);
      this.event(r.requesterId, {
        type: created ? 'negotiation.created' : 'negotiation.updated',
        requestId: r.id,
        requestVersion: r.version,
        negotiationId: n.id,
        negotiationVersion: n.version,
        reason,
      });
      if (n.ownerId)
        this.event(n.ownerId, {
          type: created ? 'negotiation.created' : 'negotiation.updated',
          requestId: r.id,
          negotiationId: n.id,
          negotiationVersion: n.version,
          reason,
        });
    }
    if (r.status === 'COLLECTING_OFFERS') await this.enqueueComparison(r);
  }
  async enqueueComparison(r: RentalRequest) {
    const negotiations = await all<Negotiation>(
      this.c,
      'negotiations',
      'WHERE request_id=$1 ORDER BY id',
      [r.id],
    );
    const current = negotiations.filter(
      (n) =>
        n.status === 'OFFERED' && n.offer && Date.parse(n.offer.validUntil) > this.now.getTime(),
    );
    if (!current.length) return;
    const inputVersion: InputVersion = {
      kind: 'COMPARE',
      offers: current.map((n) => ({
        negotiationId: n.id,
        offerId: n.offer!.id,
        termsRevision: n.termsRevision,
      })),
    };
    const prior = await all<AgentTask>(
      this.c,
      'agent_tasks',
      "WHERE request_id=$1 AND data->>'kind'='COMPARE_OFFERS'",
      [r.id],
    );
    if (prior.some((task) => canonicalHash(task.inputVersion) === canonicalHash(inputVersion)))
      return;
    const offers = [];
    for (const n of current)
      offers.push({
        negotiationId: n.id,
        offerId: n.offer!.id,
        termsRevision: n.termsRevision,
        terms: n.terms,
        itemSummary: await this.itemSummary(await this.item(n.itemId)),
        validUntil: n.offer!.validUntil,
      });
    await this.enqueue('COMPARE_OFFERS', r, inputVersion, r.requesterId, null, {
      need: ConfirmedNeedSchema.parse(r.need),
      offers,
    });
  }
  assertRequest(r: RentalRequest, expected?: number, states?: RentalRequest['status'][]) {
    if (r.status === 'EXPIRED') fail('REQUEST_EXPIRED', {}, true);
    if (expected !== undefined && r.version !== expected)
      fail('VERSION_CONFLICT', { currentRequestVersion: r.version }, true);
    if (states && !states.includes(r.status)) fail('INVALID_STATE', {}, true);
  }
  assertNegotiation(n: Negotiation, version: number, termsRevision?: number) {
    if (n.status === 'EXPIRED') fail('OFFER_EXPIRED', {}, true);
    if (n.version !== version || (termsRevision !== undefined && n.termsRevision !== termsRevision))
      fail(
        'VERSION_CONFLICT',
        { currentNegotiationVersion: n.version, currentTermsRevision: n.termsRevision },
        true,
      );
  }
  noOffers(r: RentalRequest, ns: Negotiation[]) {
    if (r.status === 'COLLECTING_OFFERS' && !ns.some(active)) r.status = 'NO_OFFERS';
  }
  async expire(r: RentalRequest, ns: Negotiation[]) {
    const expired: Negotiation[] = [];
    if (!terminal(r) && this.now.getTime() >= Date.parse(r.expiresAt)) {
      r.status = 'EXPIRED';
      for (const n of ns.filter(active)) {
        n.status = 'EXPIRED';
        n.closedReason = 'REQUEST_EXPIRED';
        expired.push(n);
      }
      await this.cancelTasks(r.id);
      await this.changed(r, expired, 'REQUEST_EXPIRED');
    } else if (!terminal(r)) {
      for (const n of ns.filter(active)) {
        const deadline = n.status === 'OFFERED' ? n.offer?.validUntil : n.responseDueAt;
        if (deadline && this.now.getTime() >= Date.parse(deadline)) {
          n.status = 'EXPIRED';
          n.closedReason = n.offer ? 'OFFER_EXPIRED' : 'RESPONSE_EXPIRED';
          expired.push(n);
        }
      }
      if (expired.length) {
        this.noOffers(r, ns);
        await this.changed(r, expired, 'BRANCH_EXPIRED');
      }
    }
    if (r.status === 'PAYMENT_PREVIEW_READY') {
      const holds = await this.c.query(
        "SELECT item_id FROM demo_holds WHERE request_id=$1 AND status='ACTIVE' AND expires_at <= $2",
        [r.id, this.iso],
      );
      await this.lockItems(holds.rows.map((v) => v.item_id as string));
      for (const row of holds.rows) await this.expireItemHolds(row.item_id);
    }
  }
  async expireItemHolds(itemId: string) {
    const holds = await this.c.query(
      "UPDATE demo_holds SET status='EXPIRED' WHERE item_id=$1 AND status='ACTIVE' AND expires_at <= $2 RETURNING request_id,negotiation_id",
      [itemId, this.iso],
    );
    for (const h of holds.rows) {
      const r = await read<RentalRequest>(this.c, 'rental_requests', h.request_id);
      if (r)
        this.event(r.requesterId, {
          type: 'demo_hold.expired',
          requestId: r.id,
          negotiationId: h.negotiation_id,
          reason: 'HOLD_EXPIRED',
        });
    }
  }
  async availability(
    item: Item,
    requesterId: string,
    terms: Pick<Terms, 'startAt' | 'endAt' | 'placeId'>,
  ): Promise<string | null> {
    if (!item.enabled) return 'ITEM_DISABLED';
    if (item.ownerId === requesterId) return 'OWN_ITEM';
    if (item.ownerId && !(await this.user(item.ownerId)).demoEligible) return 'OWNER_INELIGIBLE';
    if (item.source === 'PUBLIC' && !(await this.user(requesterId)).demoEligible)
      return 'DEMO_INELIGIBLE';
    if (!item.allowedPlaceIds.includes(terms.placeId)) return 'PLACE_UNAVAILABLE';
    if (Date.parse(terms.startAt) <= this.now.getTime()) return 'PERIOD_STARTED';
    if (
      item.unavailableIntervals.some(
        (p) =>
          Date.parse(p.startAt) < Date.parse(terms.endAt) &&
          Date.parse(p.endAt) > Date.parse(terms.startAt),
      )
    )
      return 'PERIOD_UNAVAILABLE';
    const found = await this.c.query(
      "SELECT 1 FROM demo_holds WHERE item_id=$1 AND status='ACTIVE' AND expires_at>$4 AND tstzrange(start_at,end_at,'[)') && tstzrange($2,$3,'[)') LIMIT 1",
      [item.id, terms.startAt, terms.endAt, this.iso],
    );
    return found.rowCount ? 'ACTIVE_HOLD' : null;
  }
  deadline(ms: number, r: RentalRequest, terms: Terms) {
    return new Date(
      Math.min(this.now.getTime() + ms, Date.parse(r.expiresAt), Date.parse(terms.startAt)),
    ).toISOString();
  }
  async history(n: Negotiation, actor: string | null, reason: string) {
    await this.c.query(
      'INSERT INTO terms_revisions(negotiation_id,revision,terms,actor_user_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [n.id, n.termsRevision, n.terms, actor, reason, this.iso],
    );
  }
  async makeOffer(r: RentalRequest, n: Negotiation) {
    const { timing } = await this.config();
    n.status = 'OFFERED';
    n.responseDueAt = null;
    n.offer = {
      id: id('offer'),
      negotiationId: n.id,
      termsRevision: n.termsRevision,
      terms: { ...n.terms },
      endorsedBy: n.source === 'PUBLIC' ? 'PUBLIC_DEMO' : 'OWNER',
      createdAt: this.iso,
      validUntil: this.deadline(timing.offerMs, r, n.terms),
    };
    await put(this.c, 'offers', n.offer, true);
  }
  async enqueue(
    kind: AgentTaskKind,
    r: RentalRequest,
    inputVersion: InputVersion,
    actorUserId = r.requesterId,
    negotiationId: string | null = null,
    context: Record<string, unknown> = {},
  ): Promise<AgentTask> {
    const task: AgentTask = {
      id: id('task'),
      kind,
      requestId: r.id,
      negotiationId,
      inputVersion,
      status: 'QUEUED',
      attempt: 0,
      errorCode: null,
    };
    await this.c.query(
      'INSERT INTO agent_tasks(id,data,actor_user_id,context,created_at) VALUES($1,$2,$3,$4,$5)',
      [task.id, task, actorUserId, context, this.iso],
    );
    await this.c.query("INSERT INTO outbox(kind,payload,created_at) VALUES('TASK',$1,$2)", [
      { taskId: task.id, kind: task.kind },
      this.iso,
    ]);
    await this.taskEvent(task, actorUserId);
    return task;
  }
  async taskEvent(task: AgentTask, actor: string, reason?: string) {
    const recipients = new Set([actor]);
    if (task.requestId) {
      const r = await read<RentalRequest>(this.c, 'rental_requests', task.requestId);
      if (r) recipients.add(r.requesterId);
    }
    if (task.negotiationId) {
      const n = await read<Negotiation>(this.c, 'negotiations', task.negotiationId);
      if (n?.ownerId) recipients.add(n.ownerId);
    }
    for (const user of recipients)
      this.event(user, {
        type: 'agent.task.updated',
        ...(task.requestId ? { requestId: task.requestId } : {}),
        taskId: task.id,
        ...(reason ? { reason } : {}),
      });
  }
  async cancelTasks(requestId: string) {
    const tasks = await all<AgentTask>(
      this.c,
      'agent_tasks',
      "WHERE request_id=$1 AND data->>'status' IN ('QUEUED','RUNNING')",
      [requestId],
    );
    for (const t of tasks) {
      t.status = 'CANCELLED';
      await put(this.c, 'agent_tasks', t);
      const actor = (
        await this.c.query('SELECT actor_user_id FROM agent_tasks WHERE id=$1', [t.id])
      ).rows[0].actor_user_id;
      await this.taskEvent(t, actor, 'REQUEST_CLOSED');
    }
  }
  async view(r: RentalRequest, ns?: Negotiation[]): Promise<RequestView> {
    const negotiations =
      ns ??
      (await all<Negotiation>(this.c, 'negotiations', 'WHERE request_id=$1 ORDER BY id', [r.id]));
    const comparison: ComparisonRow[] = [];
    for (const n of negotiations) {
      const original = (
        await this.c.query(
          'SELECT terms FROM terms_revisions WHERE negotiation_id=$1 AND revision=1',
          [n.id],
        )
      ).rows[0]?.terms as Terms | undefined;
      comparison.push({
        negotiationId: n.id,
        status: n.status,
        itemSummary: await this.itemSummary(await this.item(n.itemId)),
        terms: n.terms,
        changedFields: original ? changedFields(original, n.terms) : [],
        validUntil: n.offer?.validUntil ?? null,
        selectable:
          r.status === 'COLLECTING_OFFERS' &&
          n.status === 'OFFERED' &&
          !!n.offer &&
          n.termsRevision === n.offer.termsRevision &&
          Date.parse(n.offer.validUntil) > this.now.getTime(),
        unavailableReason: n.closedReason,
      });
    }
    const matching = (row: ComparisonRow) =>
      row.terms.startAt === r.need.startAt &&
      row.terms.endAt === r.need.endAt &&
      r.need.preferredPlaceIds.includes(row.terms.placeId);
    comparison.sort(
      (a, b) =>
        Number(b.selectable) - Number(a.selectable) ||
        Number(matching(b)) - Number(matching(a)) ||
        a.terms.totalFeeKrw - b.terms.totalFeeKrw ||
        (negotiations.find((n) => n.id === a.negotiationId)?.offer?.createdAt ?? '').localeCompare(
          negotiations.find((n) => n.id === b.negotiationId)?.offer?.createdAt ?? '',
        ) ||
        a.negotiationId.localeCompare(b.negotiationId),
    );
    const allowedActions: AllowedAction[] = [];
    if (r.status === 'DRAFT') allowedActions.push('EDIT_DRAFT', 'SEARCH');
    if (r.status === 'MATCHES_READY') allowedActions.push('EDIT_DRAFT', 'SUBMIT_CANDIDATES');
    if (!terminal(r)) allowedActions.push('CANCEL_REQUEST');
    if (r.status === 'COLLECTING_OFFERS') {
      if (comparison.some((n) => n.selectable)) allowedActions.push('SELECT_OFFER');
      if (negotiations.some(active)) allowedActions.push('WITHDRAW_BRANCH');
      if (
        negotiations.some(
          (n) =>
            n.source === 'RESIDENT' && n.status === 'OFFERED' && n.changeCount < LIMITS.maxChanges,
        )
      )
        allowedActions.push('REQUESTER_COUNTER');
    }
    if (r.status === 'PAYMENT_PREVIEW_READY') allowedActions.push('OPEN_PAYMENT_PREVIEW');
    return {
      request: r,
      candidates: await all(this.c, 'candidates', 'WHERE request_id=$1 ORDER BY id', [r.id]),
      negotiations,
      comparison,
      tasks: await all(this.c, 'agent_tasks', 'WHERE request_id=$1 ORDER BY id', [r.id]),
      allowedActions,
    };
  }
  async ownerCard(r: RentalRequest, n: Negotiation): Promise<OwnerCard> {
    const allowedActions: AllowedAction[] = [];
    if (!terminal(r) && active(n) && n.source === 'RESIDENT') {
      if (n.status === 'AWAITING_OWNER') allowedActions.push('OWNER_APPROVE', 'OWNER_DECLINE');
      if (n.changeCount < LIMITS.maxChanges) allowedActions.push('OWNER_COUNTER');
      allowedActions.push('WITHDRAW_BRANCH');
    }
    return {
      requestId: r.id,
      requesterDisplayName: (await this.user(r.requesterId)).displayName,
      negotiation: n,
      itemSummary: await this.itemSummary(await this.item(n.itemId)),
      allowedActions,
    };
  }
  async summary(r: RentalRequest): Promise<RequestSummary> {
    const ns = await all<Negotiation>(this.c, 'negotiations', 'WHERE request_id=$1', [r.id]);
    const { category, queryText, startAt, endAt } = r.need;
    return {
      id: r.id,
      status: r.status,
      version: r.version,
      needSummary: { category, queryText, startAt, endAt },
      activeBranchCount: ns.filter(active).length,
      offeredCount: ns.filter((n) => n.status === 'OFFERED').length,
      selectedNegotiationId: r.selectedNegotiationId,
      updatedAt: r.updatedAt,
    };
  }
  async payment(r: RentalRequest): Promise<PaymentPreview> {
    if (r.status !== 'PAYMENT_PREVIEW_READY' || !r.selectedNegotiationId) fail('INVALID_STATE');
    const n = await read<Negotiation>(this.c, 'negotiations', r.selectedNegotiationId);
    if (!n?.offer) fail('INVALID_STATE');
    const h = (await this.c.query('SELECT * FROM demo_holds WHERE request_id=$1', [r.id])).rows[0];
    return {
      mode: 'PREVIEW_ONLY',
      requestId: r.id,
      negotiationId: n.id,
      offerId: n.offer.id,
      termsRevision: n.termsRevision,
      totalFeeKrw: n.terms.totalFeeKrw,
      currency: 'KRW',
      chargeable: false,
      paymentStatus: 'NOT_APPLICABLE',
      demoHoldStatus: h.status,
      demoHoldExpiresAt: h.expires_at.toISOString(),
      notice: '실제 결제와 예약이 이루어지지 않습니다.',
      itemSummary: await this.itemSummary(await this.item(n.itemId)),
      terms: n.terms,
    };
  }
  async session(token: string | undefined): Promise<Session> {
    if (!token) fail('SESSION_EXPIRED');
    const row = (
      await this.c.query(
        'SELECT * FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2',
        [hashToken(token), this.iso],
      )
    ).rows[0];
    if (!row) fail('SESSION_EXPIRED');
    return {
      id: row.id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at.toISOString(),
      user: await this.user(row.user_id),
    };
  }
  async sessionData(s: Session): Promise<DemoSessionData> {
    return {
      user: s.user,
      csrfToken: s.csrfToken,
      sessionExpiresAt: s.expiresAt,
      demoScenario: (await this.config()).name,
    };
  }
  async createSession(handle: string, oldToken?: string) {
    const users = await all<DemoUser>(this.c, 'users', "WHERE data->>'handle'=$1", [handle]);
    const user = users[0];
    if (!user) fail('UNKNOWN_DEMO_ID');
    if (oldToken) {
      const old = (
        await this.c.query(
          'SELECT id,user_id FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL FOR UPDATE',
          [hashToken(oldToken)],
        )
      ).rows[0];
      if (old) await this.revokeSession(old.id, old.user_id);
    }
    const token = randomBytes(32).toString('base64url');
    const s: Session = {
      id: id('session'),
      userId: user.id,
      user,
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt: new Date(this.now.getTime() + LIMITS.sessionMs).toISOString(),
    };
    await this.c.query(
      'INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5)',
      [s.id, s.userId, hashToken(token), s.csrfToken, s.expiresAt],
    );
    return { token, session: s, data: await this.sessionData(s) };
  }
  async revokeSession(sessionId: string, userId: string) {
    const result = await this.c.query(
      'UPDATE sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id',
      [sessionId, this.iso],
    );
    if (result.rowCount) this.event(userId, { type: 'session.revoked', reason: 'SESSION_REVOKED' });
  }
}
export function changedFields(a: Terms, b: Terms): ChangedField[] {
  const result: ChangedField[] = [];
  if (a.startAt !== b.startAt) result.push('START_AT');
  if (a.endAt !== b.endAt) result.push('END_AT');
  if (a.placeId !== b.placeId) result.push('PLACE');
  if (a.totalFeeKrw !== b.totalFeeKrw) result.push('TOTAL_FEE');
  return result;
}
