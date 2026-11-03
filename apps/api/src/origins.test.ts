import { expect, it, vi } from 'vitest';
import { createTestDatabase } from '@sb/db';
import { buildApi } from './index.js';

it('accepts exact configured origins and rejects unlisted or lookalike origins', async () => {
  const { db, cleanup } = await createTestDatabase();
  vi.stubEnv('APP_ORIGINS', ' http://localhost:8000, http://127.0.0.1:8000 ');
  const app = await buildApi({ db });
  try {
    for (const origin of ['http://localhost:8000', 'http://127.0.0.1:8000']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle: 'demo-hana' },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const origin of ['http://unlisted.example', 'http://localhost:8000.evil.example']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle: 'demo-hana' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('CSRF_REJECTED');
    }
  } finally {
    await app.close();
    await cleanup();
    vi.unstubAllEnvs();
  }
});
