import {
  NeedDraftSchema,
  ConfirmedNeedSchema,
  TermsSchema,
  validatePeriod,
  canonicalHash,
  LIMITS,
  POLICY_VERSION,
  type NeedDraft,
  type RentalRequest,
  type Negotiation,
  type Candidate,
  type PricingQuote,
  type Terms,
  type InputVersion,
  type PatchDraftBody,
  type SubmitRequestBody,
  type PriceQuoteBody,
  type OwnerResponseBody,
  type RequesterCounterBody,
  type SelectOfferBody,
  type AgentTurnBody,
  type FeeRecommender,
} from '@sb/contracts';
import { Unit, active, terminal, changedFields } from './unit.js';
import { all, read, put, fail, id, DomainError } from './storage.js';
import { quoteFor } from './pricing.js';
export class Commands extends Unit {
  async create(actor: string, need: NeedDraft) {
    NeedDraftSchema.parse(need);
    await this.validatePlaces(need.preferredPlaceIds);
    const { timing } = await this.config();
    const r: RentalRequest = {
      id: id('req'),
      requesterId: actor,
      version: 1,
      needRevision: 1,
      status: 'DRAFT',
      need,
      createdAt: this.iso,
      updatedAt: this.iso,
      expiresAt: new Date(this.now.getTime() + timing.rootMs).toISOString(),
      selectedNegotiationId: null,
    };
    await put(this.c, 'rental_requests', r, true);
    await this.needHistory(r);
    this.event(actor, {
      type: 'request.updated',
      requestId: r.id,
      requestVersion: r.version,
      reason: 'CREATED',
    });
    return this.view(r);
  }
  async needHistory(r: RentalRequest) {
    await this.c.query(
      'INSERT INTO request_need_revisions(request_id,revision,need,created_at) VALUES($1,$2,$3,$4)',
      [r.id, r.needRevision, r.need, this.iso],
    );
  }
  async validatePlaces(ids: string[]) {
    if (new Set(ids).size !== ids.length) fail('VALIDATION_ERROR');
    const places = await this.places();
    if (ids.some((p) => !places.some((v) => v.id === p))) fail('VALIDATION_ERROR');
  }
  async getRequest(actor: string, requestId: string) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    return this.view(r, ns);
  }
  async patchDraft(actor: string, requestId: string, body: PatchDraftBody) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, body.expectedRequestVersion, ['DRAFT', 'MATCHES_READY']);
    NeedDraftSchema.parse(body.need);
    await this.validatePlaces(body.need.preferredPlaceIds);
    if (canonicalHash(r.need) === canonicalHash(body.need)) return this.view(r, ns);
    r.need = body.need;
    r.needRevision++;
    r.status = 'DRAFT';
    await this.needHistory(r);
    await this.c.query('DELETE FROM candidates WHERE request_id=$1', [r.id]);
    await this.cancelTasks(r.id);
    await this.changed(r, [], 'DRAFT_CHANGED');
    return this.view(r, ns);
  }
  async confirmAndSearch(actor: string, requestId: string, expectedVersion: number) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, expectedVersion, ['DRAFT']);
    const parsed = ConfirmedNeedSchema.safeParse(r.need);
    if (!parsed.success)
      fail('VALIDATION_ERROR', { fields: parsed.error.issues.map((i) => i.path.join('.')) });
    if (!validatePeriod(parsed.data.startAt, parsed.data.endAt, this.now).valid)
      fail('VALIDATION_ERROR');
    await this.validatePlaces(parsed.data.preferredPlaceIds);
    await this.c.query(
      'INSERT INTO summary_confirmations(request_id,need_revision,actor_user_id,confirmed_at) VALUES($1,$2,$3,$4)',
      [r.id, r.needRevision, actor, this.iso],
    );
    r.status = 'SEARCHING';
    await this.changed(r, [], 'SEARCH_CONFIRMED');
    const task = await this.enqueue('SEARCH', r, { kind: 'NEED', needRevision: r.needRevision });
    return { request: await this.view(r, ns), taskId: task.id };
  }
  async cancel(actor: string, requestId: string, expectedVersion: number) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, expectedVersion, [
      'DRAFT',
      'SEARCHING',
      'MATCHES_READY',
      'COLLECTING_OFFERS',
    ]);
    r.status = 'CANCELLED';
    const changed = ns.filter(active);
    for (const n of changed) {
      n.status = 'WITHDRAWN';
      n.closedReason = 'REQUEST_CANCELLED';
    }
    await this.cancelTasks(r.id);
    await this.changed(r, changed, 'REQUEST_CANCELLED');
    return this.view(r, ns);
  }
  async issueQuote(actor: string, body: PriceQuoteBody, feeRecommender?: FeeRecommender) {
    const r = await this.lockRequest(body.requestId, actor, true);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, undefined, ['MATCHES_READY', 'COLLECTING_OFFERS']);
    if (body.negotiationId) {
      const n = ns.find((n) => n.id === body.negotiationId && n.itemId === body.itemId);
      if (!n || (r.requesterId !== actor && n.ownerId !== actor)) fail('NOT_FOUND');
      if (!active(n) || n.source === 'PUBLIC') fail('INVALID_STATE');
    } else {
      if (
        r.requesterId !== actor ||
        r.status !== 'MATCHES_READY' ||
        !(
          await this.c.query(
            "SELECT 1 FROM candidates WHERE request_id=$1 AND data->>'itemId'=$2",
            [r.id, body.itemId],
          )
        ).rowCount
      )
        fail('NOT_FOUND');
    }
    if (!validatePeriod(body.startAt, body.endAt, this.now).valid) fail('VALIDATION_ERROR');
    const item = await this.item(body.itemId);
    return quoteFor(this, r, item, body.startAt, body.endAt, body.negotiationId, feeRecommender);
  }
  async validateQuote(
    r: RentalRequest,
    itemId: string,
    negotiationId: string | null,
    terms: Terms,
    fresh = true,
  ) {
    TermsSchema.parse(terms);
    const q = await read<PricingQuote>(this.c, 'pricing_quotes', terms.quoteId);
    if (
      !q ||
      q.requestId !== r.id ||
      q.itemId !== itemId ||
      q.negotiationId !== negotiationId ||
      q.startAt !== terms.startAt ||
      q.endAt !== terms.endAt ||
      q.policyVersion !== POLICY_VERSION
    )
      fail('VALIDATION_ERROR');
    if (fresh && this.now.getTime() >= Date.parse(q.expiresAt)) fail('QUOTE_EXPIRED');
    if (
      !Number.isSafeInteger(terms.totalFeeKrw) ||
      terms.totalFeeKrw < q.minKrw ||
      terms.totalFeeKrw > q.maxKrw ||
      terms.totalFeeKrw % 500 !== 0
    )
      fail('PRICE_OUT_OF_RANGE', { minKrw: q.minKrw, maxKrw: q.maxKrw });
    if (!validatePeriod(terms.startAt, terms.endAt, this.now).valid) fail('VALIDATION_ERROR');
    if (!(await this.item(itemId)).allowedPlaceIds.includes(terms.placeId))
      fail('VALIDATION_ERROR');
    return q;
  }
  async submit(actor: string, requestId: string, body: SubmitRequestBody) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, body.expectedRequestVersion, ['MATCHES_READY']);
    if (
      body.selections.length < 1 ||
      body.selections.length > 3 ||
      new Set(body.selections.map((s) => s.candidateId)).size !== body.selections.length
    )
      fail('VALIDATION_ERROR');
    const candidates = await all<Candidate>(this.c, 'candidates', 'WHERE request_id=$1', [r.id]);
    const selected = body.selections.map((s) => ({
      s,
      c: candidates.find((c) => c.id === s.candidateId),
    }));
    await this.lockItems(selected.flatMap((v) => (v.c ? [v.c.itemId] : [])));
    const candidateErrors: { candidateId: string; code: string }[] = [];
    for (const { s, c } of selected) {
      try {
        if (!c) fail('NOT_FOUND');
        if (c.availability !== 'AVAILABLE') fail('AVAILABILITY_CONFLICT');
        const terms = { ...c.suggestedTerms, totalFeeKrw: s.totalFeeKrw, quoteId: s.quoteId };
        await this.validateQuote(r, c.itemId, null, terms);
        if (await this.availability(await this.item(c.itemId), actor, terms))
          fail('AVAILABILITY_CONFLICT');
      } catch (e) {
        if (e instanceof DomainError)
          candidateErrors.push({ candidateId: s.candidateId, code: e.code });
        else throw e;
      }
    }
    if (candidateErrors.length) {
      const code = candidateErrors[0]!.code as DomainError['code'];
      fail(code, { candidateErrors });
    }
    const { timing } = await this.config();
    const created: Negotiation[] = [];
    for (const { s, c } of selected) {
      const item = await this.item(c!.itemId);
      const terms = { ...c!.suggestedTerms, totalFeeKrw: s.totalFeeKrw, quoteId: s.quoteId };
      const n: Negotiation = {
        id: id('neg'),
        requestId: r.id,
        itemId: item.id,
        ownerId: item.ownerId,
        source: item.source,
        version: 1,
        status: item.source === 'PUBLIC' ? 'PENDING_PUBLIC' : 'AWAITING_OWNER',
        termsRevision: 1,
        terms,
        changeCount: 0,
        responseDueAt: this.deadline(timing.responseMs, r, terms),
        offer: null,
        closedReason: null,
        updatedAt: this.iso,
      };
      await put(this.c, 'negotiations', n, true);
      await this.history(n, actor, 'SUBMITTED');
      created.push(n);
      if (item.source === 'PUBLIC')
        await this.enqueue(
          'PUBLIC_SUBMIT',
          r,
          { kind: 'TERMS', negotiationId: n.id, termsRevision: 1 },
          actor,
          n.id,
        );
    }
    r.status = 'COLLECTING_OFFERS';
    await this.changed(r, created, 'SUBMITTED', true);
    return this.view(r, created);
  }
  async ownerResponse(actor: string, negotiationId: string, body: OwnerResponseBody) {
    const { r, ns, n } = await this.negotiationRoot(negotiationId, actor, 'OWNER');
    this.assertRequest(r, undefined, ['COLLECTING_OFFERS']);
    this.assertNegotiation(n, body.expectedNegotiationVersion, body.expectedTermsRevision);
    if (body.action === 'COUNTER') {
      if (!['AWAITING_OWNER', 'OFFERED'].includes(n.status)) fail('INVALID_STATE');
      await this.counterTerms(r, n, body.terms, actor, body.reasonCode ?? 'OWNER_COUNTERED');
      await this.makeOffer(r, n);
    } else {
      if (n.status !== 'AWAITING_OWNER') fail('INVALID_STATE');
      if (body.action === 'DECLINE') {
        n.status = 'DECLINED';
        n.closedReason = body.reasonCode;
        n.responseDueAt = null;
      } else await this.makeOffer(r, n);
    }
    this.noOffers(r, ns);
    await this.changed(r, [n], `OWNER_${body.action}`);
    return this.ownerCard(r, n);
  }
  async counterTerms(
    r: RentalRequest,
    n: Negotiation,
    terms: Terms,
    actor: string,
    reason: string,
  ) {
    if (!changedFields(n.terms, terms).length) fail('NO_CHANGES');
    if (n.changeCount >= LIMITS.maxChanges) fail('CHANGE_LIMIT_REACHED');
    await this.validateQuote(r, n.itemId, n.id, terms);
    await this.lockItems([n.itemId]);
    if (await this.availability(await this.item(n.itemId), r.requesterId, terms))
      fail('AVAILABILITY_CONFLICT');
    const oldTerms = n.terms;
    n.terms = { ...terms };
    n.termsRevision++;
    n.changeCount++;
    n.offer = null;
    await this.history(n, actor, reason);
    await this.enqueue(
      'EXPLAIN_TERMS',
      r,
      {
        kind: 'NEGOTIATION',
        negotiationId: n.id,
        negotiationVersion: n.version + 1,
        termsRevision: n.termsRevision,
      },
      actor,
      n.id,
      { oldTerms, newTerms: terms },
    );
  }
  async requesterCounter(actor: string, negotiationId: string, body: RequesterCounterBody) {
    const { r, ns, n } = await this.negotiationRoot(negotiationId, actor, 'REQUESTER');
    this.assertRequest(r, undefined, ['COLLECTING_OFFERS']);
    this.assertNegotiation(n, body.expectedNegotiationVersion, body.expectedTermsRevision);
    if (n.source !== 'RESIDENT' || n.status !== 'OFFERED') fail('INVALID_STATE');
    await this.counterTerms(r, n, body.terms, actor, body.reasonCode ?? 'REQUESTER_COUNTERED');
    n.status = 'AWAITING_OWNER';
    n.responseDueAt = this.deadline((await this.config()).timing.responseMs, r, n.terms);
    await this.changed(r, [n], 'REQUESTER_COUNTERED');
    return this.view(r, ns);
  }
  async withdraw(actor: string, negotiationId: string, expectedVersion: number) {
    const { r, ns, n } = await this.negotiationRoot(negotiationId, actor);
    this.assertRequest(r, undefined, ['COLLECTING_OFFERS']);
    this.assertNegotiation(n, expectedVersion);
    if (!active(n)) fail('INVALID_STATE');
    n.status = 'WITHDRAWN';
    n.closedReason = r.requesterId === actor ? 'REQUESTER_WITHDREW' : 'OWNER_WITHDREW';
    n.responseDueAt = null;
    this.noOffers(r, ns);
    await this.changed(r, [n], n.closedReason);
    return r.requesterId === actor ? this.view(r, ns) : this.ownerCard(r, n);
  }
  async select(actor: string, requestId: string, body: SelectOfferBody) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    if (r.selectedNegotiationId) fail('ALREADY_SELECTED');
    if (r.status === 'EXPIRED') fail('REQUEST_EXPIRED', {}, true);
    const n = ns.find((n) => n.id === body.negotiationId);
    if (!n) fail('NOT_FOUND');
    if (n.status === 'EXPIRED') fail('OFFER_EXPIRED', {}, true);
    this.assertRequest(r, body.expectedRequestVersion, ['COLLECTING_OFFERS']);
    this.assertNegotiation(n, body.expectedNegotiationVersion, body.termsRevision);
    if (
      n.status !== 'OFFERED' ||
      !n.offer ||
      n.offer.id !== body.offerId ||
      n.offer.termsRevision !== n.termsRevision ||
      !body.acknowledgeCloseOtherBranches
    )
      fail('INVALID_STATE');
    if (this.now.getTime() >= Date.parse(n.offer.validUntil)) fail('OFFER_EXPIRED', {}, true);
    const q = await read<PricingQuote>(this.c, 'pricing_quotes', n.terms.quoteId);
    if (
      !q ||
      q.policyVersion !== POLICY_VERSION ||
      n.terms.totalFeeKrw < q.minKrw ||
      n.terms.totalFeeKrw > q.maxKrw
    )
      fail('PRICE_OUT_OF_RANGE');
    await this.lockItems([n.itemId]);
    await this.expire(r, ns);
    this.assertRequest(r);
    this.assertNegotiation(n, body.expectedNegotiationVersion, body.termsRevision);
    await this.expireItemHolds(n.itemId);
    const item = await this.item(n.itemId);
    const unavailable = await this.availability(item, actor, n.terms);
    if (unavailable) {
      n.status = 'UNAVAILABLE';
      n.closedReason = unavailable;
      this.noOffers(r, ns);
      await this.changed(r, [n], 'AVAILABILITY_CONFLICT');
      fail('AVAILABILITY_CONFLICT', { negotiationId: n.id }, true);
    }
    const expiresAt = new Date(
      this.now.getTime() + (await this.config()).timing.holdMs,
    ).toISOString();
    await this.c.query(
      "INSERT INTO demo_holds(id,request_id,negotiation_id,item_id,start_at,end_at,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
      [id('hold'), r.id, n.id, n.itemId, n.terms.startAt, n.terms.endAt, expiresAt],
    );
    const changed = ns.filter(active);
    for (const other of changed) {
      other.status = other.id === n.id ? 'SELECTED' : 'SUPERSEDED';
      other.closedReason = other.id === n.id ? null : 'OTHER_SELECTED';
      other.responseDueAt = null;
    }
    r.status = 'PAYMENT_PREVIEW_READY';
    r.selectedNegotiationId = n.id;
    await this.cancelTasks(r.id);
    await this.changed(r, changed, 'OFFER_SELECTED');
    return { request: await this.view(r, ns), paymentPreview: await this.payment(r) };
  }
  async paymentPreview(actor: string, requestId: string) {
    const r = await this.lockRequest(requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    return this.payment(r);
  }
  async getNegotiation(actor: string, negotiationId: string) {
    const { r, n } = await this.negotiationRoot(negotiationId, actor);
    return actor === r.requesterId ? n : this.ownerCard(r, n);
  }
  async finishVoice(actor: string, body: AgentTurnBody, voiceSessionId: string) {
    const r = await this.lockRequest(body.requestId, actor);
    const existing = await this.c.query(
      "SELECT id FROM agent_tasks WHERE request_id=$1 AND context->>'voiceSessionId'=$2 AND context->>'finalizeAfterCall'='true'",
      [r.id, voiceSessionId],
    );
    if (existing.rows[0]) return { taskId: existing.rows[0].id as string };
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, body.expectedRequestVersion, ['DRAFT']);
    const turnId = id('turn');
    await this.cancelTasks(r.id);
    await this.c.query('UPDATE rental_requests SET latest_turn_id=$2 WHERE id=$1', [r.id, turnId]);
    const task = await this.enqueue(
      'EXTRACT_NEED',
      r,
      { kind: 'NEED', needRevision: r.needRevision, turnId },
      actor,
      null,
      {
        text: body.text,
        draft: r.need,
        places: await this.places(),
        voiceSessionId,
        finalizeAfterCall: true,
      },
    );
    return { taskId: task.id };
  }
  async agentTurn(actor: string, body: AgentTurnBody, voice?: { voiceSessionId: string }) {
    const r = await this.lockRequest(body.requestId, actor);
    const ns = await this.lockNegotiations(r.id);
    await this.expire(r, ns);
    this.assertRequest(r, body.expectedRequestVersion);
    if (terminal(r)) fail('INVALID_STATE');
    const turnId = id('turn');
    await this.c.query('UPDATE rental_requests SET latest_turn_id=$2 WHERE id=$1', [r.id, turnId]);
    const task = await this.enqueue('ROUTE_INTENT', r, { kind: 'TURN', turnId }, actor, null, {
      text: body.text,
      ...(voice ? { voiceSessionId: voice.voiceSessionId } : {}),
      currentScreen: 'REQUEST',
      allowedRoutes: [
        'RENTAL_REQUEST',
        'CHANGE_CONDITIONS',
        'STATUS_QUERY',
        'CENTER_INFO',
        'UNCLEAR',
      ],
    });
    return { taskId: task.id };
  }
  async inputCurrent(r: RentalRequest, input: InputVersion): Promise<boolean> {
    if (terminal(r)) return false;
    const ns = await all<Negotiation>(this.c, 'negotiations', 'WHERE request_id=$1', [r.id]);
    switch (input.kind) {
      case 'TURN':
        return (
          (await this.c.query('SELECT latest_turn_id FROM rental_requests WHERE id=$1', [r.id]))
            .rows[0].latest_turn_id === input.turnId
        );
      case 'NEED':
        return (
          r.needRevision === input.needRevision &&
          (!('turnId' in input) ||
            (await this.c.query('SELECT latest_turn_id FROM rental_requests WHERE id=$1', [r.id]))
              .rows[0].latest_turn_id === input.turnId)
        );
      case 'TERMS':
        return ns.some(
          (n) =>
            n.id === input.negotiationId &&
            n.termsRevision === input.termsRevision &&
            n.status === 'PENDING_PUBLIC',
        );
      case 'NEGOTIATION':
        return ns.some(
          (n) =>
            n.id === input.negotiationId &&
            n.version === input.negotiationVersion &&
            n.termsRevision === input.termsRevision,
        );
      case 'FEE':
        return !!(
          await this.c.query(
            "SELECT 1 FROM pricing_quotes WHERE request_id=$1 AND data->>'conditionsHash'=$2 AND data->>'policyVersion'=$3 AND (data->>'expiresAt')::timestamptz>$4",
            [r.id, input.conditionsHash, input.policyVersion, this.iso],
          )
        ).rowCount;
      case 'COMPARE':
        return (
          canonicalHash(input.offers) ===
          canonicalHash(
            ns
              .filter(
                (n) =>
                  n.status === 'OFFERED' &&
                  n.offer &&
                  Date.parse(n.offer.validUntil) > this.now.getTime(),
              )
              .map((n) => ({
                negotiationId: n.id,
                offerId: n.offer!.id,
                termsRevision: n.termsRevision,
              }))
              .sort((a, b) => a.negotiationId.localeCompare(b.negotiationId)),
          )
        );
    }
  }
}
