import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'acceptance',
    environment: 'node',
    include: ['tests/acceptance/**/*.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 30_000,
    maxWorkers: 3,
    env: { AI_MODE: 'fixture', APP_MODE: 'automated-test' },
  },
});
