import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@sb/contracts',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
