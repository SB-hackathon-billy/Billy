import { afterAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RentalRequest } from '@sb/contracts';
import { harness, type Harness, selectBody, until } from './harness.js';
let h: Harness;
afterAll(async () => {
  await h?.close();
});
it('AT09/AT18/AT19 expiry-fast real 30s Offer/hold and 90s root deadlines', async () => {
  h = await harness({ scenario: 'expiry-fast' });
  const began = Date.now();
  expect((await h.api('hana', 'GET', '/me')).json().data.demoScenario).toBe('expiry-fast');
  const pending = await h.submit(await h.matches(), ['res-projector-duri']);
  const offered = await h.submit(await h.matches('jun'), ['res-projector-seul'], 'jun');
  await h.response(offered.negotiations[0]!);
  const offerView = await h.fresh(offered.request.id, 'jun');
  const selectPending = await h.submit(
    await h.matches('hana', h.need({ category: 'CLEANING', queryText: '청소기' })),
    ['res-cleaner-duri'],
  );
  await h.response(selectPending.negotiations[0]!);
  const selectedView = await h.fresh(selectPending.request.id);
  const selected = await h.select(selectedView, selectedView.negotiations[0]!);
  const initial = selected.paymentPreview;
  expect(Date.parse(initial.demoHoldExpiresAt) - Date.now()).toBeGreaterThan(28000);
  expect(initial.paymentStatus).toBe('NOT_APPLICABLE');
  // Read stored rows directly to prove the timer worker, rather than a lazy GET, persisted expiry.
  await until(
    async () =>
      (
        await h.db.pool.query('SELECT status FROM demo_holds WHERE request_id=$1', [
          selectedView.request.id,
        ])
      ).rows[0]?.status,
    (s) => s === 'EXPIRED',
    40000,
  );
  const holdElapsed = Date.now() - began;
  const preview = (
    await h.api('hana', 'GET', `/requests/${selectedView.request.id}/payment-preview`)
  ).json().data;
  expect(preview).toMatchObject({
    mode: 'PREVIEW_ONLY',
    chargeable: false,
    paymentStatus: 'NOT_APPLICABLE',
    demoHoldStatus: 'EXPIRED',
  });
  expect((await h.fresh(selectedView.request.id)).request.status).toBe('PAYMENT_PREVIEW_READY');
  const reuse = await h.api(
    'hana',
    'POST',
    `/requests/${selectedView.request.id}/select`,
    selectBody(selectedView, selectedView.negotiations[0]!),
  );
  expect(reuse.statusCode).toBe(409);
  expect(reuse.json().error.code).toBe('ALREADY_SELECTED');
  expect(
    (
      await h.db.pool.query('SELECT status FROM demo_holds WHERE request_id=$1', [
        selectedView.request.id,
      ])
    ).rows,
  ).toEqual([{ status: 'EXPIRED' }]);
  const expired = await h.api(
    'jun',
    'POST',
    `/requests/${offerView.request.id}/select`,
    selectBody(offerView, offerView.negotiations[0]!),
  );
  expect(expired.statusCode, expired.body).toBe(410);
  expect(expired.json().error.code).toBe('OFFER_EXPIRED');
  expect((await h.fresh(offerView.request.id, 'jun')).request.status).toBe('NO_OFFERS');
  const root = await until(
    async () =>
      (
        await h.db.pool.query<{ data: RentalRequest }>(
          'SELECT data FROM rental_requests WHERE id=$1',
          [pending.request.id],
        )
      ).rows[0]!.data,
    (r) => r.status === 'EXPIRED',
    65000,
  );
  expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(root.expiresAt));
  const ended = await h.fresh(root.id);
  expect(ended.negotiations[0]).toMatchObject({ status: 'EXPIRED', offer: null });
  const after = await h.api(
    'duri',
    'POST',
    `/negotiations/${ended.negotiations[0]!.id}/owner-response`,
    {
      action: 'APPROVE',
      expectedNegotiationVersion: ended.negotiations[0]!.version,
      expectedTermsRevision: ended.negotiations[0]!.termsRevision,
      terms: null,
    },
  );
  expect(after.statusCode).toBe(410);
  const result = {
    recordedAt: new Date().toISOString(),
    scenario: 'expiry-fast',
    realClock: true,
    holdObservedAfterMs: holdElapsed,
    rootObservedAfterMs: Date.now() - began,
    offerCode: expired.json().error.code,
    rootStatus: root.status,
    paymentStatus: preview.paymentStatus,
  };
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('./results/expiry.json', import.meta.url),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(`ACCEPTANCE_EXPIRY ${JSON.stringify(result)}`);
}, 115000);
