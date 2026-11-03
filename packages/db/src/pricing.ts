import {
  canonicalHash,
  computeFeeOptions,
  POLICY_VERSION,
  LIMITS,
  RecommendFeeResultSchema,
  type Item,
  type RentalRequest,
  type PricingQuote,
  type FeeRecommender,
  type PricingReasonCode,
  type RecommendFeeResult,
  type AgentTask,
} from '@sb/contracts';
import { type Unit } from './unit.js';
import { all, id, put, fail } from './storage.js';
export async function quoteFor(
  u: Unit,
  r: RentalRequest,
  item: Item,
  startAt: string,
  endAt: string,
  negotiationId: string | null,
  feeRecommender?: FeeRecommender,
): Promise<PricingQuote> {
  const preferredPlaceCount = r.need.preferredPlaceIds.length || 1;
  const allowedReasonCodes: PricingReasonCode[] = ['BASELINE'];
  if (preferredPlaceCount > 1) allowedReasonCodes.push('FLEXIBLE_HANDOFF');
  if (item.pricingFacts.registeredExtraEffort) allowedReasonCodes.push('REGISTERED_EXTRA_EFFORT');
  const conditionsHash = canonicalHash({
    itemId: item.id,
    source: item.source,
    dailyRateKrw: item.dailyRateKrw,
    startAt,
    endAt,
    policyVersion: POLICY_VERSION,
    preferredPlaceCount,
    allowedReasonCodes,
  });
  const existing = await all<PricingQuote>(
    u.c,
    'pricing_quotes',
    "WHERE request_id=$1 AND data->>'itemId'=$2 AND (data->>'negotiationId') IS NOT DISTINCT FROM $3 AND data->>'conditionsHash'=$4 AND (data->>'expiresAt')::timestamptz>$5 ORDER BY id LIMIT 1",
    [r.id, item.id, negotiationId, conditionsHash, u.iso],
  );
  if (existing[0]) return existing[0];
  const computed = computeFeeOptions(item.dailyRateKrw, startAt, endAt, item.source);
  let recommendation: RecommendFeeResult | null = null;
  let inlineTask: AgentTask | undefined;
  if (item.source === 'RESIDENT') {
    const cached = (
      await u.c.query('SELECT data FROM fee_cache WHERE conditions_hash=$1 AND expires_at>$2', [
        conditionsHash,
        u.iso,
      ])
    ).rows[0]?.data as RecommendFeeResult | undefined;
    if (cached) recommendation = cached;
    else if (feeRecommender) {
      inlineTask = await u.enqueue(
        'RECOMMEND_FEE',
        r,
        { kind: 'FEE', conditionsHash, policyVersion: POLICY_VERSION },
        r.requesterId,
        negotiationId,
        {
          item: {
            id: item.id,
            title: item.title,
            source: item.source,
            pricingFacts: item.pricingFacts,
          },
          startAt,
          endAt,
          feeOptions: computed.feeOptions,
          allowedReasonCodes,
          preferredPlaceCount,
        },
      );
      inlineTask.status = 'RUNNING';
      inlineTask.attempt = 1;
      await put(u.c, 'agent_tasks', inlineTask);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          feeRecommender.recommend({
            taskId: inlineTask.id,
            kind: 'RECOMMEND_FEE',
            actorUserId: r.requesterId,
            requestId: r.id,
            negotiationId,
            inputVersion: { kind: 'FEE', conditionsHash, policyVersion: POLICY_VERSION },
            locale: 'ko-KR',
            timeZone: 'Asia/Seoul',
            serverNow: u.iso,
            context: {
              item: {
                id: item.id,
                title: item.title,
                source: item.source,
                pricingFacts: item.pricingFacts,
              },
              startAt,
              endAt,
              feeOptions: computed.feeOptions,
              allowedReasonCodes,
              preferredPlaceCount,
            },
          }),
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), LIMITS.feeRecommendationMs);
          }),
        ]);
        const result = RecommendFeeResultSchema.safeParse(raw);
        if (result.success && allowedReasonCodes.includes(result.data.reasonCode))
          recommendation = result.data;
      } catch {
        recommendation = null;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    if (recommendation)
      await u.c.query(
        'INSERT INTO fee_cache(conditions_hash,data,expires_at) VALUES($1,$2,$3) ON CONFLICT(conditions_hash) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at',
        [
          conditionsHash,
          recommendation,
          new Date(u.now.getTime() + LIMITS.feeRecommendationMs + 300_000).toISOString(),
        ],
      );
  }
  u.refreshClock();
  if (u.now.getTime() >= Date.parse(r.expiresAt)) {
    await u.expire(r, await u.lockNegotiations(r.id));
    fail('REQUEST_EXPIRED', {}, true);
  }
  const quote: PricingQuote = {
    id: id('quote'),
    itemId: item.id,
    requestId: r.id,
    negotiationId,
    conditionsHash,
    startAt,
    endAt,
    billingDays: computed.billingDays,
    baselineKrw: computed.baselineKrw,
    minKrw: computed.minKrw,
    maxKrw: computed.maxKrw,
    recommendedKrw: recommendation
      ? computed.feeOptions[recommendation.feeOptionId]
      : computed.baselineKrw,
    recommendationSource:
      item.source === 'PUBLIC' ? 'PUBLIC_FIXED' : recommendation ? 'AI' : 'BASELINE',
    reasonCode: recommendation?.reasonCode ?? 'BASELINE',
    policyVersion: POLICY_VERSION,
    createdAt: u.iso,
    expiresAt: new Date(u.now.getTime() + 300_000).toISOString(),
  };
  await put(u.c, 'pricing_quotes', quote, true);
  if (inlineTask) {
    inlineTask.status = recommendation ? 'SUCCEEDED' : 'FAILED';
    inlineTask.errorCode = recommendation ? null : 'FEE_BASELINE_FALLBACK';
    await put(u.c, 'agent_tasks', inlineTask);
    await u.c.query('UPDATE agent_tasks SET result=$2 WHERE id=$1', [
      inlineTask.id,
      recommendation,
    ]);
    await u.c.query(
      'INSERT INTO task_effects(task_id,step,input_hash,created_at) VALUES($1,$2,$3,$4)',
      [inlineTask.id, 'INLINE_FEE', canonicalHash(inlineTask.inputVersion), u.iso],
    );
    await u.taskEvent(inlineTask, r.requesterId);
  }
  return quote;
}
