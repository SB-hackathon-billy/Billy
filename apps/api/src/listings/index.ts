// 2번 AI 물품 등록 API. 명세: docs/specs/0002-item-registration.md
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as C from '@sb/contracts';
import { all, fail, id, put, type Commands } from '@sb/db';
import { createListingDrafter, type ListingDrafter } from '@sb/ai';
import { paginate } from '../index.js';

const FAR_PAST = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2999-12-31T00:00:00.000Z';

/** 게시 전에 채워져야 하는 필드. 빈 배열이면 게시 가능. */
export function missingForPublish(l: C.Listing): string[] {
  const missing: string[] = [];
  if (!l.title.trim()) missing.push('title');
  if (!l.category) missing.push('category');
  if (!l.dailyRateKrw) missing.push('dailyRateKrw');
  if (!l.placeId) missing.push('placeId');
  if (l.availableFrom && l.availableTo && l.availableFrom >= l.availableTo)
    missing.push('availableTo');
  return missing;
}

/**
 * 기존 검색·대여(items 테이블)가 게시 물품을 찾도록 쓰는 호환 투영.
 * 2번 원장은 listings이고 items 행은 listings에서만 파생된다.
 */
export function toItem(l: C.Listing): C.Item {
  const unavailableIntervals = [
    ...(l.availableFrom ? [{ startAt: FAR_PAST, endAt: l.availableFrom }] : []),
    ...(l.availableTo ? [{ startAt: l.availableTo, endAt: FAR_FUTURE }] : []),
  ];
  return C.ItemSchema.parse({
    id: l.id,
    source: 'RESIDENT',
    ownerId: l.ownerId,
    title: l.title,
    category: l.category,
    image: { url: `/api/v1/images/${l.imageIds[0]}`, alt: l.title, isIllustration: false },
    enabled: l.status === 'PUBLISHED',
    allowedPlaceIds: [l.placeId],
    dailyRateKrw: l.dailyRateKrw,
    pricingFacts: { registeredExtraEffort: false },
    unavailableIntervals,
    publicScenario: null,
  });
}

export default async function listingsPlugin(app: FastifyInstance) {
  const { db, envelope, requireSession, mutation } = app.demo;
  let drafter: ListingDrafter | undefined;
  const param = (r: FastifyRequest) => C.IdSchema.parse((r.params as { id: string }).id);
  const now = () => db.now().toISOString();

  async function lock(u: Commands, listingId: string, ownerId: string, expectedVersion: number) {
    const row = await u.c.query('SELECT data FROM listings WHERE id=$1 FOR UPDATE', [listingId]);
    const l = row.rows[0]?.data as C.Listing | undefined;
    if (!l || l.ownerId !== ownerId) fail('NOT_FOUND');
    if (l.version !== expectedVersion) fail('VERSION_CONFLICT', { currentVersion: l.version });
    return l;
  }
  async function save(u: Commands, l: C.Listing) {
    await put(u.c, 'listings', l);
    if (l.status === 'DRAFT') return;
    const item = toItem(l);
    await u.c.query(
      'INSERT INTO items(id,data) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data',
      [item.id, item],
    );
  }
  async function requirePublishable(u: Commands, l: C.Listing) {
    const missing = missingForPublish(l);
    if (
      !missing.length &&
      !(await u.c.query('SELECT 1 FROM places WHERE id=$1', [l.placeId])).rowCount
    )
      missing.push('placeId');
    if (missing.length) fail('VALIDATION_ERROR', { fields: missing });
  }

  // 사진은 앱이 줄여서 base64 JSON으로 보낸다. 기본 bodyLimit(150KB)보다 커서 이 경로만 늘린다.
  app.post('/api/v1/images', { bodyLimit: 7_000_000 }, async (request, reply) => {
    const { userId } = requireSession(request);
    const body = C.ImageUploadBodySchema.parse(request.body);
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (!bytes.length || bytes.length > C.MAX_IMAGE_BYTES) fail('BAD_REQUEST');
    const imageId = id('img');
    await db.transaction((u) =>
      u.c.query('INSERT INTO item_images(id,owner_id,content_type,bytes) VALUES($1,$2,$3,$4)', [
        imageId,
        userId,
        body.contentType,
        bytes,
      ]),
    );
    return reply.code(201).send(envelope({ id: imageId, url: `/api/v1/images/${imageId}` }));
  });

  app.get('/api/v1/images/:id', async (request, reply) => {
    requireSession(request);
    const r = await db.transaction((u) =>
      u.c.query('SELECT content_type, bytes FROM item_images WHERE id=$1', [param(request)]),
    );
    const row = r.rows[0] as { content_type: string; bytes: Buffer } | undefined;
    if (!row) fail('NOT_FOUND');
    return reply.type(row.content_type).send(row.bytes);
  });

  mutation('POST', '/listings', 201, async (u, req) => {
    const { userId } = requireSession(req);
    const body = C.CreateListingBodySchema.parse(req.body);
    const ids = [...new Set(body.imageIds)];
    const rows = (
      await u.c.query(
        'SELECT id, content_type, bytes FROM item_images WHERE id=ANY($1::text[]) AND owner_id=$2',
        [ids, userId],
      )
    ).rows as { id: string; content_type: string; bytes: Buffer }[];
    if (rows.length !== ids.length) fail('NOT_FOUND');
    let draft: C.AiListingDraft | null = null;
    // ponytail: AI 호출이 멱등 트랜잭션 안에서 실행된다(수 초간 DB 연결 점유). 동시 등록이 많아지면 비동기 작업으로 분리.
    try {
      drafter ??= createListingDrafter();
      const byId = new Map(rows.map((r) => [r.id, r]));
      draft = await drafter(
        ids.map((i) => ({ contentType: byId.get(i)!.content_type, bytes: byId.get(i)!.bytes })),
        body.userNotes,
      );
    } catch (error) {
      req.log.warn({ code: (error as { code?: string }).code }, 'listing draft AI failed');
    }
    const at = now();
    const listing: C.Listing = {
      id: id('lst'),
      ownerId: userId,
      status: 'DRAFT',
      version: 1,
      imageIds: ids,
      aiStatus: draft ? 'DONE' : 'FAILED',
      title: draft?.title ?? '',
      category: draft?.category ?? null,
      description: draft?.description ?? '',
      unknowns: draft?.unknowns ?? [],
      dailyRateKrw: null,
      placeId: null,
      availableFrom: null,
      availableTo: null,
      createdAt: at,
      updatedAt: at,
    };
    await put(u.c, 'listings', listing, true);
    return listing;
  });

  mutation('PATCH', '/listings/:id', 200, async (u, req) => {
    const { expectedVersion, ...changes } = C.PatchListingBodySchema.parse(req.body);
    const l = await lock(u, param(req), requireSession(req).userId, expectedVersion);
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const next: C.Listing = { ...l, ...set, version: l.version + 1, updatedAt: now() };
    if (next.status === 'PUBLISHED') await requirePublishable(u, next);
    await save(u, next);
    return next;
  });

  mutation('POST', '/listings/:id/publish', 200, async (u, req) => {
    const { expectedVersion } = C.ListingVersionBodySchema.parse(req.body);
    const l = await lock(u, param(req), requireSession(req).userId, expectedVersion);
    if (l.status === 'PUBLISHED') fail('INVALID_STATE');
    const next: C.Listing = { ...l, status: 'PUBLISHED', version: l.version + 1, updatedAt: now() };
    await requirePublishable(u, next);
    await save(u, next);
    return next;
  });

  mutation('POST', '/listings/:id/deactivate', 200, async (u, req) => {
    const { expectedVersion } = C.ListingVersionBodySchema.parse(req.body);
    const l = await lock(u, param(req), requireSession(req).userId, expectedVersion);
    if (l.status !== 'PUBLISHED') fail('INVALID_STATE');
    const next: C.Listing = { ...l, status: 'INACTIVE', version: l.version + 1, updatedAt: now() };
    await save(u, next);
    return next;
  });

  app.get('/api/v1/listings', async (request) => {
    const { userId } = requireSession(request);
    const q = C.ListingsQuerySchema.parse(request.query);
    const mine = q.mine === 'true';
    const rows = await db.transaction((u) =>
      mine
        ? all<C.Listing>(u.c, 'listings', 'WHERE owner_id=$1', [userId])
        : all<C.Listing>(u.c, 'listings', "WHERE status='PUBLISHED'"),
    );
    const filtered = rows.filter((l) => !q.category || l.category === q.category);
    return envelope(
      paginate(filtered, q, (l) => l.id, `listings:${mine ? userId : ''}:${q.category ?? ''}`),
    );
  });

  app.get('/api/v1/listings/:id', async (request) => {
    const { userId } = requireSession(request);
    const r = await db.transaction((u) =>
      u.c.query('SELECT data FROM listings WHERE id=$1', [param(request)]),
    );
    const l = r.rows[0]?.data as C.Listing | undefined;
    if (!l || (l.status !== 'PUBLISHED' && l.ownerId !== userId)) fail('NOT_FOUND');
    return envelope(l);
  });
}
