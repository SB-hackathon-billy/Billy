import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const artifacts = resolve('test-artifacts/e2e');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore:
    process.env.E2E_SCENARIO === 'expiry-fast'
      ? ['**/multiparty.spec.ts', '**/resilience.spec.ts']
      : '**/expiry.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  outputDir: `${artifacts}/runs-${process.env.E2E_SCENARIO ?? 'default'}`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${artifacts}/results-${process.env.E2E_SCENARIO ?? 'default'}.json` }],
  ],
  use: {
    baseURL: 'http://localhost:8000',
    browserName: 'chromium',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    launchOptions: {
      args: ['--use-fake-device-for-media-stream'],
    },
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
