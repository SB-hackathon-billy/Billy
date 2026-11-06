import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { createTestDatabase, type Database } from '@sb/db';
import { DemoSessionDataSchema, ListingSchema, ItemSchema, type Listing } from '@sb/contracts';
import { buildApi } from '../index.js';

process.env.AI_MODE = 'fixture';
const origin = 'http://localhost:8000';
const PNG = (
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
).toString('base64');
let db: Database, app: FastifyInstance, cleanup: () => Promise<void>;
const actors: Record<string, { cookie: string; csrf: string }> = {};

async function enter(handle: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle },
  });
  const data = DemoSessionDataSchema.parse(res.json().data);
  return { cookie: res.cookies[0]!.name + '=' + res.cookies[0]!.value, csrf: data.csrfToken };
}
function call(who: string, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object) {
  const a = actors[who]!;
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { origin, cookie: a.cookie, 'x-csrf-token': a.csrf, 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  });
}

beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  cleanup = test.cleanup;
  app = await buildApi({ db, rateLimitMax: 10000 });
  for (const who of ['hana', 'duri']) actors[who] = await enter(`demo-${who}`);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});

describe('2번 AI 물품 등록', () => {
  it('rejects non-image uploads before inserting any database row', async () => {
    const count = async () =>
      Number((await db.pool.query('SELECT count(*) AS n FROM item_images')).rows[0].n);
    const before = await count();
    const res = await call('hana', 'POST', '/images', {
      contentType: 'image/png',
      dataBase64: Buffer.from('not-an-image').toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
    expect(await count()).toBe(before);
  });
  it('사진 → AI 초안 → 수정 → 게시 → 검색 원장 투영 → 비활성화', async () => {
    let res = await call('hana', 'POST', '/images', { contentType: 'image/png', dataBase64: PNG });
    expect(res.statusCode).toBe(201);
    const image = res.json().data as { id: string; url: string };
    expect((await call('hana', 'GET', `/images/${image.id}`)).headers['content-type']).toBe(
      'image/png',
    );

    // 남의 사진으로는 초안을 만들 수 없다
    expect((await call('duri', 'POST', '/listings', { imageIds: [image.id] })).statusCode).toBe(
      404,
    );

    res = await call('hana', 'POST', '/listings', { imageIds: [image.id], userNotes: '이사 정리' });
    expect(res.statusCode).toBe(201);
    let l: Listing = ListingSchema.parse(res.json().data);
    expect(l).toMatchObject({ status: 'DRAFT', aiStatus: 'DONE', category: 'CLEANING' });
    expect(l.title).not.toBe('');

    // 초안은 다른 사람에게 보이지 않고 items에도 없다
    expect((await call('duri', 'GET', `/listings/${l.id}`)).statusCode).toBe(404);
    expect((await call('duri', 'GET', `/items/${l.id}`)).statusCode).toBe(404);

    // 필수 항목이 비어 있으면 게시 거부
    res = await call('hana', 'POST', `/listings/${l.id}/publish`, { expectedVersion: l.version });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual(['dailyRateKrw', 'placeId']);

    res = await call('hana', 'PATCH', `/listings/${l.id}`, {
      expectedVersion: l.version,
      title: '무선 청소기 (충전기 포함)',
      dailyRateKrw: 2000,
      placeId: 'place-center',
      availableFrom: '2026-12-01T00:00:00.000Z',
      availableTo: '2026-12-31T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const stale = l.version;
    l = ListingSchema.parse(res.json().data);
    expect(
      (await call('hana', 'PATCH', `/listings/${l.id}`, { expectedVersion: stale, title: 'x' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('duri', 'PATCH', `/listings/${l.id}`, { expectedVersion: l.version, title: 'x' }))
        .statusCode,
    ).toBe(404);

    res = await call('hana', 'POST', `/listings/${l.id}/publish`, { expectedVersion: l.version });
    expect(res.statusCode).toBe(200);
    l = ListingSchema.parse(res.json().data);
    expect(l.status).toBe('PUBLISHED');

    res = await call('duri', 'GET', '/listings');
    expect((res.json().data.items as Listing[]).map((x) => x.id)).toContain(l.id);
    let item = ItemSchema.parse((await call('duri', 'GET', `/items/${l.id}`)).json().data);
    expect(item).toMatchObject({
      source: 'RESIDENT',
      ownerId: 'u_hana',
      enabled: true,
      dailyRateKrw: 2000,
    });
    expect(item.unavailableIntervals).toHaveLength(2);

    res = await call('hana', 'POST', `/listings/${l.id}/deactivate`, {
      expectedVersion: l.version,
    });
    expect(res.statusCode).toBe(200);
    item = ItemSchema.parse((await call('duri', 'GET', `/items/${l.id}`)).json().data);
    expect(item.enabled).toBe(false);
    res = await call('duri', 'GET', '/listings');
    expect((res.json().data.items as Listing[]).map((x) => x.id)).not.toContain(l.id);
    res = await call('hana', 'GET', '/listings?mine=true');
    expect((res.json().data.items as Listing[]).map((x) => x.status)).toEqual(['INACTIVE']);
  });

  it('캠퍼스 거점이 있으면 거점에서만 주고받도록 게시를 막는다', async () => {
    await db.pool.query(
      `INSERT INTO places(id,data) VALUES('place-hansung', '{"id":"place-hansung","label":"한성대 거점","description":"캠퍼스 거점","isDemo":true}')`,
    );
    let res = await call('hana', 'POST', '/images', { contentType: 'image/png', dataBase64: PNG });
    const image = res.json().data as { id: string };
    res = await call('hana', 'POST', '/listings', { imageIds: [image.id] });
    let l: Listing = ListingSchema.parse(res.json().data);
    const patch = async (placeId: string) => {
      res = await call('hana', 'PATCH', `/listings/${l.id}`, {
        expectedVersion: l.version,
        title: '전동 드릴',
        category: 'TOOLS',
        dailyRateKrw: 1500,
        placeId,
      });
      expect(res.statusCode).toBe(200);
      l = ListingSchema.parse(res.json().data);
    };
    await patch('place-center');
    res = await call('hana', 'POST', `/listings/${l.id}/publish`, { expectedVersion: l.version });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual(['placeId']);
    await patch('place-hansung');
    res = await call('hana', 'POST', `/listings/${l.id}/publish`, { expectedVersion: l.version });
    expect(res.statusCode, res.body).toBe(200);
  });
});
