import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type Database } from '@sb/db';
import { buildApi } from './index.js';

let db: Database, cleanup: () => Promise<void>;
beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  cleanup = test.cleanup;
});
afterAll(async () => {
  await cleanup();
});

it.each(['http://localhost:8000', 'https://qa.example'])(
  'sets and clears session cookie security for %s',
  async (origin) => {
    const app = await buildApi({ db, appOrigin: origin });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle: 'demo-hana' },
      });
      expect(login.statusCode).toBe(201);
      expect(Boolean(login.cookies[0]?.secure)).toBe(origin.startsWith('https:'));
      const cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
      const logout = await app.inject({
        method: 'DELETE',
        url: '/api/v1/demo-sessions/current',
        headers: {
          origin,
          cookie,
          'x-csrf-token': login.json().data.csrfToken,
          'idempotency-key': randomUUID(),
        },
      });
      expect(logout.statusCode).toBe(204);
      expect(Boolean(logout.cookies[0]?.secure)).toBe(origin.startsWith('https:'));
    } finally {
      await app.close();
    }
  },
);

it('isolates verified users behind one IP, shares a user bucket across sessions, and rejects spoofed identities', async () => {
  const origin = 'http://localhost:8000';
  const app = await buildApi({ db, appOrigin: origin, rateLimitMax: 5 });
  try {
    const enter = async (handle: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle },
      });
      expect(res.statusCode).toBe(201);
      return `${res.cookies[0]!.name}=${res.cookies[0]!.value}`;
    };
    const hana = await enter('demo-hana');
    const duri = await enter('demo-duri');
    const hanaAgain = await enter('demo-hana');
    const read = (cookie: string) =>
      app.inject({ url: '/api/v1/me', headers: { cookie, 'x-forwarded-for': randomUUID() } });
    for (let i = 0; i < 5; i++) expect((await read(i % 2 ? hanaAgain : hana)).statusCode).toBe(200);
    expect((await read(hana)).statusCode).toBe(429);
    expect((await read(duri)).statusCode).toBe(200);
    // Login has its own stricter route bucket; invalid sessions share the global IP bucket.
    for (let i = 0; i < 5; i++) expect((await read(`demo_session=fake-${i}`)).statusCode).toBe(401);
    expect((await read('demo_session=fake-6')).statusCode).toBe(429);
  } finally {
    await app.close();
  }
});

it('keeps the narrower anonymous login limit and checks CSRF before parsing request bodies', async () => {
  const origin = 'http://localhost:8000';
  const app = await buildApi({ db, appOrigin: origin });
  try {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/reservations',
      headers: { origin: 'https://other.invalid', 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('CSRF_REJECTED');
    // Invalid input consumes no session rows, but still exercises the login-specific 30/min bucket.
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle: '' },
      });
      expect(res.statusCode).toBe(422);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-sessions',
      headers: { origin },
      payload: { handle: 'demo-hana' },
    });
    expect(limited.statusCode).toBe(429);
    // The default global IP bucket is still below its 120 request cap.
    expect((await app.inject({ url: '/api/v1/places' })).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
