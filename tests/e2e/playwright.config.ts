import { defineConfig } from '@playwright/test';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Chromium's service-worker fetch does not inherit context.ignoreHTTPSErrors.
// Scope the automated exception to this project's certificate public key only.
const certificate = new X509Certificate(readFileSync('infra/certs/local.pem'));
const certificateSpki = createHash('sha256')
  .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
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
    baseURL: 'https://localhost:8443',
    browserName: 'chromium',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        `--ignore-certificate-errors-spki-list=${certificateSpki}`,
      ],
    },
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // Automation only. Physical-device acceptance requires trusting the project CA.
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
