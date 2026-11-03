import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as C from '@sb/contracts';
import { harness, type Harness, stream, until } from './harness.js';
let h: Harness;
const runs: {
  run: number;
  succeeded: boolean;
  elapsedMs: number;
  latencyMs: number[];
  upperBoundMs: number[];
}[] = [];
afterEach(async () => {
  await h?.close();
});
afterAll(async () => {
  const values = runs.flatMap((r) => r.latencyMs).sort((a, b) => a - b);
  const upper = runs.flatMap((r) => r.upperBoundMs).sort((a, b) => a - b);
  const result = {
    recordedAt: new Date().toISOString(),
    transport: 'loopback TCP SSE; real PostgreSQL COMMIT observation',
    measurement:
      'Latency from COMMIT acknowledgement to SSE frame parse; actual commit lies between COMMIT send and acknowledgement, so upperBound also reported. Negative acknowledgement samples clamp to 0.',
    attempts: runs.length,
    successes: runs.filter((r) => r.succeeded).length,
    failures: runs.filter((r) => !r.succeeded).length,
    samples: values.length,
    p95Ms: values[Math.ceil(values.length * 0.95) - 1] ?? null,
    maxMs: values.at(-1) ?? null,
    p95UpperBoundMs: upper[Math.ceil(upper.length * 0.95) - 1] ?? null,
    runs,
  };
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('./results/repetition.json', import.meta.url),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(`ACCEPTANCE_REPEAT ${JSON.stringify(result)}`);
});
describe('contract §14 default multi-owner flow repeated ten times', () => {
  for (let run = 1; run <= 10; run++)
    it(`AT04/AT07/AT19 repetition ${run}/10: 3,000 / 4,500 / 3,000 → Duri preview`, async () => {
      const started = performance.now();
      const record = {
        run,
        succeeded: false,
        elapsedMs: 0,
        latencyMs: [] as number[],
        upperBoundMs: [] as number[],
      };
      runs.push(record);
      let connection: Awaited<ReturnType<typeof stream>> | undefined;
      try {
        h = await harness();
        const cursor = (await h.sync()).eventCursor;
        connection = await stream(h, 'hana', cursor);
        const found = await h.matches();
        expect(
          Date.parse(found.request.need.endAt!) - Date.parse(found.request.need.startAt!),
        ).toBe(30 * 3600000);
        const quotes = (
          await h.db.pool.query<{ data: C.PricingQuote }>(
            'SELECT data FROM pricing_quotes WHERE request_id=$1',
            [found.request.id],
          )
        ).rows.map((r) => r.data);
        expect(quotes.find((q) => q.itemId === 'pub-projector')).toMatchObject({
          baselineKrw: 3000,
          minKrw: 3000,
          maxKrw: 3000,
          recommendedKrw: 3000,
          recommendationSource: 'PUBLIC_FIXED',
        });
        expect(quotes.find((q) => q.itemId === 'res-projector-duri')).toMatchObject({
          baselineKrw: 4000,
          minKrw: 3000,
          maxKrw: 5000,
          billingDays: 2,
        });
        expect(quotes.find((q) => q.itemId === 'res-projector-seul')).toMatchObject({
          baselineKrw: 3000,
          minKrw: 2000,
          maxKrw: 4000,
          billingDays: 2,
        });
        const submitted = await h.submit(found);
        const duri = submitted.negotiations.find((n) => n.ownerId === 'u_duri')!;
        const seul = submitted.negotiations.find((n) => n.ownerId === 'u_seul')!;
        const dq = await h.quote(duri, 'duri');
        expect(seul.terms).toMatchObject({ placeId: 'place-station', totalFeeKrw: 3000 });
        await Promise.all([
          h.response(duri, 'COUNTER', {
            ...duri.terms,
            placeId: 'place-library',
            totalFeeKrw: 4500,
            quoteId: dq.id,
          }),
          h.response(seul, 'APPROVE'),
        ]);
        const offered = await until(
          () => h.fresh(found.request.id),
          (v) => v.negotiations.every((n) => n.status === 'OFFERED'),
        );
        expect(offered.comparison).toHaveLength(3);
        expect(offered.comparison.every((r) => r.selectable)).toBe(true);
        expect(
          offered.negotiations.find((n) => n.itemId === 'pub-projector')!.terms.totalFeeKrw,
        ).toBe(3000);
        expect(offered.negotiations.find((n) => n.id === duri.id)!.terms).toMatchObject({
          totalFeeKrw: 4500,
          placeId: 'place-library',
        });
        expect(offered.negotiations.find((n) => n.id === seul.id)!.terms).toMatchObject({
          totalFeeKrw: 3000,
          placeId: 'place-station',
        });
        const selected = await h.select(
          offered,
          offered.negotiations.find((n) => n.id === duri.id)!,
        );
        expect(selected.request.request).toMatchObject({
          status: 'PAYMENT_PREVIEW_READY',
          selectedNegotiationId: duri.id,
        });
        expect(
          selected.request.negotiations
            .filter((n) => n.id !== duri.id)
            .every((n) => n.status === 'SUPERSEDED'),
        ).toBe(true);
        expect(selected.paymentPreview).toMatchObject({
          mode: 'PREVIEW_ONLY',
          chargeable: false,
          paymentStatus: 'NOT_APPLICABLE',
          totalFeeKrw: 4500,
          demoHoldStatus: 'ACTIVE',
        });
        const event = await connection.wait(
          (e) =>
            e.type === 'request.updated' &&
            e.data.requestId === found.request.id &&
            e.data.requestVersion === selected.request.request.version,
        );
        expect(event.data.reason).toBe('OFFER_SELECTED');
        for (const received of connection.events.filter(
          (e) => e.id && e.data.requestId === found.request.id,
        )) {
          const commit = h.db.commits.get(`u_hana:${received.id}`);
          expect(commit, `observed real commit for ${received.id}`).toBeDefined();
          const lower = Math.max(0, received.received - commit!.acknowledged);
          const upper = Math.max(0, received.received - commit!.sent);
          record.latencyMs.push(Number(lower.toFixed(3)));
          record.upperBoundMs.push(Number(upper.toFixed(3)));
        }
        expect(record.latencyMs.length).toBeGreaterThan(10);
        expect(Math.max(...record.upperBoundMs)).toBeLessThan(2000);
        record.succeeded = true;
      } finally {
        record.elapsedMs = Number((performance.now() - started).toFixed(1));
        await connection?.close();
      }
    });
});
