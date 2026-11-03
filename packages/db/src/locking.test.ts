import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmptyNeed } from '@sb/contracts';
import { createTestDatabase } from './testing.js';
let test: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  test = await createTestDatabase();
});
afterAll(async () => {
  await test.cleanup();
});
it('concurrent request inserts keep FK key-share locks compatible with event cursor serialization', async () => {
  let arrived = 0;
  let release!: () => void;
  const bothInserted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = await test.db.sync('u_hana');
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      test.db.transaction(async (u) => {
        const view = await u.create('u_hana', createEmptyNeed());
        // Each real INSERT now holds the referenced user's KEY SHARE lock. Both transactions
        // must reach flush with those locks held to reproduce the former FOR UPDATE deadlock.
        if (++arrived === 2) release();
        await bothInserted;
        return view;
      }),
    ),
  );
  expect(attempts.map((a) => a.status)).toEqual(['fulfilled', 'fulfilled']);
  const events = await test.db.eventsAfter('u_hana', before.eventCursor);
  expect(events.events).toHaveLength(2);
  expect(BigInt(events.events[1]!.eventId)).toBe(BigInt(events.events[0]!.eventId) + 1n);
  const snapshot = await test.db.sync('u_hana');
  expect(snapshot.requestSummaries).toHaveLength(2);
  expect(snapshot.eventCursor).toBe(events.events[1]!.eventId);
});
