import { beforeAll, afterAll, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDatabase, type Database } from '@sb/db';
import { createEmptyNeed, SseEventSchema } from '@sb/contracts';
import { buildApi } from './index.js';
let app: FastifyInstance, db: Database, cleanup: () => Promise<void>, base: string, cookie: string;
const origin = 'http://localhost:8000';
beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, heartbeatMs: 40, rateLimitMax: 10000 });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle: 'demo-hana' },
  });
  cookie = res.cookies[0]!.name + '=' + res.cookies[0]!.value;
});
afterAll(async () => {
  await app.close();
  await cleanup();
});
async function stream(after = '0', last?: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/v1/events?after=${after}`, {
    headers: { cookie, ...(last ? { 'Last-Event-ID': last } : {}) },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let text = '';
  const decoder = new TextDecoder();
  return {
    async next() {
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        while (!text.includes('\n\n')) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('SSE closed before expected event');
          text += decoder.decode(chunk.value, { stream: true });
        }
        const index = text.indexOf('\n\n');
        const event = text.slice(0, index);
        text = text.slice(index + 2);
        return {
          raw: event,
          type: event
            .split('\n')
            .find((l) => l.startsWith('event: '))
            ?.slice(7),
          id: event
            .split('\n')
            .find((l) => l.startsWith('id: '))
            ?.slice(4),
          data: JSON.parse(
            event
              .split('\n')
              .find((l) => l.startsWith('data: '))!
              .slice(6),
          ) as Record<string, unknown>,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => {});
    },
  };
}
it('real SSE streams commit events in cursor order, reconnects after Last-Event-ID and sends heartbeat without id', async () => {
  const before = await db.sync('u_hana');
  const connection = await stream(before.eventCursor);
  try {
    const beat = await connection.next();
    expect(beat.type).toBe('heartbeat');
    expect(beat.id).toBeUndefined();
    expect(beat.data.serverTime).toBeTypeOf('string');
    const committed = await Promise.all([
      db.transaction((u) => u.create('u_hana', createEmptyNeed())),
      db.transaction((u) => u.create('u_hana', createEmptyNeed())),
    ]);
    const received = [];
    while (received.length < 2) {
      const event = await connection.next();
      if (event.type !== 'heartbeat') received.push(event);
    }
    expect(received.map((e) => e.type)).toEqual(['request.updated', 'request.updated']);
    expect(BigInt(received[1]!.id!)).toBe(BigInt(received[0]!.id!) + 1n);
    expect(new Set(received.map((e) => e.data.requestId))).toEqual(
      new Set(committed.map((v) => v.request.id)),
    );
    for (const e of received) SseEventSchema.parse(e.data);
    const reconnect = await stream(before.eventCursor, received[0]!.id);
    try {
      // Heartbeats may arrive while PostgreSQL is replaying the durable events,
      // especially when the complete suite runs concurrently.
      let event;
      do {
        event = await reconnect.next();
      } while (event.type === 'heartbeat');
      expect(event.id).toBe(received[1]!.id);
      expect(event.data).toEqual(received[1]!.data);
    } finally {
      await reconnect.close();
    }
  } finally {
    await connection.close();
  }
});
it('expired cursor emits sync.required and session rotation closes only its old session', async () => {
  const latest = await db.sync('u_hana');
  await db.pool.query(
    "UPDATE user_events SET occurred_at=now()-interval '25 hours' WHERE user_id='u_hana'",
  );
  const expired = await stream('0');
  try {
    let event;
    do {
      event = await expired.next();
    } while (event.type === 'heartbeat');
    expect(event.type).toBe('sync.required');
  } finally {
    await expired.close();
  }
  const connection = await stream(latest.eventCursor);
  try {
    await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin, cookie },
      payload: { handle: 'demo-duri' },
    });
    let event;
    do {
      event = await connection.next();
    } while (event.type === 'heartbeat');
    expect(event.type).toBe('session.revoked');
    expect(BigInt(event.id!)).toBeGreaterThan(BigInt(latest.eventCursor));
    SseEventSchema.parse(event.data);
  } finally {
    await connection.close();
  }
});
