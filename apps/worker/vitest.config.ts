import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sb/worker',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 30_000,
  },
});
