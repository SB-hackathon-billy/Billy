// 3번 거점 인계·반납 HTTP 테스트. 명세: docs/specs/0007-hub-handover-return.md
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  DemoSessionDataSchema,
  HandoverViewSchema,
  NotificationListSchema,
  ReservationViewSchema,
  type HandoverView,
} from '@sb/contracts';
import { createTestDatabase, type Database } from '@sb/db';
import { buildApi } from '../index.js';

process.env.AI_MODE = 'fixture';

let db: Database, app: FastifyInstance, cleanup: () => Promise<void>;
const now = new Date('2026-11-02T01:00:00Z');
const origin = 'http://localhost:8000';
const actors: Record<string, { cookie: string; csrf: string }> = {};

function api(who: string, method: 'GET' | 'POST', path: string, payload?: unknown) {
  const a = actors[who]!;
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin,
      cookie: a.cookie,
      'x-csrf-token': a.csrf,
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
async function ok<T>(res: Awaited<ReturnType<typeof api>>, schema: { parse(v: unknown): T }) {
  expect(res.statusCode, res.body).toBeLessThan(300);
  return schema.parse(res.json().data);
}
const photo = async () =>
  (
    await api('hub', 'POST', '/images', {
      contentType: 'image/jpeg',
      dataBase64: Buffer.from('fake-jpeg-bytes').toString('base64'),
    })
  ).json().data.id as string;
const types = async (who: string) =>
  (await ok(await api(who, 'GET', '/notifications'), NotificationListSchema)).items.map(
    (n) => n.type,
  );

beforeAll(async () => {
  const test = await createTestDatabase({ now: () => now });
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, rateLimitMax: 10_000 });
  for (const who of ['hana', 'duri', 'hub']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: `demo-${who}` },
    });
    expect(res.statusCode, res.body).toBe(201);
    const data = DemoSessionDataSchema.parse(res.json().data);
    actors[who] = {
      cookie: `${res.cookies[0]!.name}=${res.cookies[0]!.value}`,
      csrf: data.csrfToken,
    };
  }
});
afterAll(async () => {
  await app.close();
  await cleanup();
});

describe('3번 거점 인계·반납', () => {
  it('runs pickup → return with AI candidates → manager inspection, with guards', async () => {
    const created = await ok(
      await api('hana', 'POST', '/reservations', {
        itemId: 'res-cleaner-duri',
        placeId: 'place-center',
        startAt: '2026-11-03T01:00:00.000Z',
        endAt: '2026-11-03T05:00:00.000Z',
      }),
      ReservationViewSchema,
    );
    const confirmed = await ok(
      await api('duri', 'POST', `/reservations/${created.reservation.id}/respond`, {
        action: 'APPROVE',
        expectedVersion: created.reservation.version,
      }),
      ReservationViewSchema,
    );
    expect(confirmed.reservation.status).toBe('CONFIRMED');

    const mine = await ok(
      await api('hana', 'GET', `/reservations/${created.reservation.id}`),
      ReservationViewSchema,
    );
    const code = mine.reservation.handover!.code!;
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(mine.reservation.handover!.stage).toBe('READY');
    expect(mine.allowedActions).toContain('CANCEL');
    // 빌려준 이웃 화면에는 코드가 없다.
    const owners = await ok(
      await api('duri', 'GET', `/reservations/${created.reservation.id}`),
      ReservationViewSchema,
    );
    expect(owners.reservation.handover).not.toHaveProperty('code');

    // 관리자만, 맞는 코드로만.
    expect((await api('hana', 'GET', `/handovers/${code}`)).statusCode).toBe(404);
    expect((await api('hub', 'GET', '/handovers/ABCDEFGH')).statusCode).toBe(404);
    let hub: HandoverView = await ok(
      await api('hub', 'GET', `/handovers/${code.toLowerCase()}`),
      HandoverViewSchema,
    );
    expect(hub.requesterDisplayName).toBe('하나');

    // 반납은 인계 전에 할 수 없다.
    expect(
      (
        await api('hub', 'POST', `/handovers/${code}/return`, {
          expectedVersion: hub.reservation.version,
          photoId: await photo(),
        })
      ).statusCode,
    ).toBe(409);

    hub = await ok(
      await api('hub', 'POST', `/handovers/${code}/pickup`, {
        expectedVersion: hub.reservation.version,
        photoId: await photo(),
      }),
      HandoverViewSchema,
    );
    expect(hub.reservation.handover!.stage).toBe('PICKED_UP');
    expect(await types('hana')).toContain('HANDOVER_PICKED_UP');
    expect(await types('duri')).toContain('HANDOVER_PICKED_UP');

    // 인계 뒤에는 취소할 수 없다.
    const after = await ok(
      await api('hana', 'GET', `/reservations/${created.reservation.id}`),
      ReservationViewSchema,
    );
    expect(after.allowedActions).not.toContain('CANCEL');
    expect(
      (
        await api('hana', 'POST', `/reservations/${created.reservation.id}/cancel`, {
          expectedVersion: after.reservation.version,
        })
      ).statusCode,
    ).toBe(409);

    hub = await ok(
      await api('hub', 'POST', `/handovers/${code}/return`, {
        expectedVersion: hub.reservation.version,
        photoId: await photo(),
      }),
      HandoverViewSchema,
    );
    expect(hub.reservation.handover!.stage).toBe('RETURNED');
    expect(hub.reservation.handover!.comparison).toMatchObject({ status: 'DONE' });
    expect(hub.reservation.handover!.comparison!.differences.length).toBeGreaterThan(0);

    // 파손 판정에는 메모가 필요하다.
    expect(
      (
        await api('hub', 'POST', `/handovers/${code}/inspect`, {
          expectedVersion: hub.reservation.version,
          result: 'DAMAGED',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await api('hub', 'POST', `/handovers/${code}/inspect`, {
          expectedVersion: hub.reservation.version - 1,
          result: 'OK',
        })
      ).statusCode,
    ).toBe(409);
    hub = await ok(
      await api('hub', 'POST', `/handovers/${code}/inspect`, {
        expectedVersion: hub.reservation.version,
        result: 'OK',
      }),
      HandoverViewSchema,
    );
    expect(hub.reservation.handover).toMatchObject({
      stage: 'COMPLETED',
      inspection: { result: 'OK', note: null },
    });
    expect(await types('hana')).toContain('HANDOVER_RETURNED');
    const history = (
      await ok(
        await api('hana', 'GET', `/reservations/${created.reservation.id}`),
        ReservationViewSchema,
      )
    ).history.map((h) => h.reason);
    expect(history).toEqual(
      expect.arrayContaining(['HANDOVER_PICKED_UP', 'HANDOVER_RETURNED', 'INSPECTED_OK']),
    );
  });
});
