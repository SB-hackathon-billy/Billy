import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PolicyMatchSchema } from '@sb/contracts';
import { createTestDatabase, type Database } from '@sb/db';
import { buildApi } from '../index.js';

process.env.AI_MODE = 'fixture';
const origin = 'http://localhost:8000';
let app: FastifyInstance, db: Database, cleanup: () => Promise<void>;
let cookie: string, csrf: string;

const match = (
  payload: unknown,
  headers: Record<string, string> = { cookie, 'x-csrf-token': csrf },
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/policy-matches',
    headers: { origin, 'idempotency-key': randomUUID(), ...headers },
    payload: payload as Record<string, unknown>,
  });

beforeAll(async () => {
  ({ db, cleanup } = await createTestDatabase());
  app = await buildApi({ db, rateLimitMax: 10_000 });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/demo-sessions',
    headers: { origin },
    payload: { handle: 'demo-hana' },
  });
  cookie = `${res.cookies[0]!.name}=${res.cookies[0]!.value}`;
  csrf = res.json().data.csrfToken as string;
});
afterAll(async () => {
  await app?.close();
  await cleanup?.();
});

describe('POST /policy-matches', () => {
  it('returns the policies for the situation in the call utterances', async () => {
    const res = await match({ utterances: ['다음 주에 여행 가는데', '캐리어가 필요해요'] });
    expect(res.statusCode, res.body).toBe(200);
    expect(PolicyMatchSchema.parse(res.json().data)).toEqual({
      situation: '여행·오래 쓰기',
      policyIds: ['rental-guide'],
    });
  });
  it('returns an empty list when no situation is mentioned', async () => {
    const res = await match({ utterances: ['내일 센터에서 프로젝터 받을게요'] });
    expect(res.json().data).toEqual({ situation: null, policyIds: [] });
  });
  it('validates the body and requires a session', async () => {
    expect((await match({ utterances: [] })).statusCode).toBe(422);
    expect((await match({ utterances: ['여행'], extra: true })).statusCode).toBe(422);
    expect((await match({ utterances: ['여행'] }, {})).statusCode).toBe(401);
  });
  it('limits each session separately even when callers share one IP behind the proxy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'demo-duri' },
    });
    const duri = {
      cookie: `${res.cookies[0]!.name}=${res.cookies[0]!.value}`,
      'x-csrf-token': res.json().data.csrfToken as string,
    };
    const codes: number[] = [];
    for (let i = 0; i < 31; i++)
      codes.push((await match({ utterances: ['여행'] }, duri)).statusCode);
    expect(codes.slice(0, 30).every((code) => code === 200)).toBe(true);
    expect(codes[30]).toBe(429);
    expect((await match({ utterances: ['여행'] })).statusCode).toBe(200);
  });
});
