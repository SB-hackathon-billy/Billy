import { expect, it, vi } from 'vitest';
import { createTestDatabase } from '@sb/db';
import { buildApi } from './index.js';

it('accepts exact configured HTTPS origins and rejects unlisted or lookalike origins', async () => {
  const { db, cleanup } = await createTestDatabase();
  vi.stubEnv('APP_ORIGINS', ' https://localhost:8443, https://192.168.1.2:8443 ');
  const app = await buildApi({ db });
  try {
    for (const origin of ['https://localhost:8443', 'https://192.168.1.2:8443']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/demo-sessions',
        headers: { origin },
        payload: { handle: 'demo-hana' },
      });
      expect(response.statusCode).toBe(201);
    }
    for (const origin of ['https://unlisted.example', 'https://localhost:8443.evil.example']) {
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
