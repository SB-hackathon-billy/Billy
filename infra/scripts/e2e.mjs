import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { compose, composeEnvironment, root, run } from './common.mjs';

// Only the test's private database is seeded/dropped. The shared sb DB is preserved.
const database = `sb_e2e_${randomUUID().replaceAll('-', '')}`;
const env = composeEnvironment({
  SB_DATABASE_URL: `postgres://sb:sb@db:5432/${database}`,
  SB_AI_MODE: 'fixture',
  SB_APP_MODE: 'automated-test',
});
let created = false;
let code = 1;
try {
  run('npx', ['tsc', '--project', 'tests/e2e/tsconfig.json']);
  run('npm', ['run', 'up']);
  compose([
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'sb',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `CREATE DATABASE ${database}`,
  ]);
  created = true;
  compose(['stop', 'worker', 'api']);
  compose(['run', '--rm', '--no-deps', 'api', 'npm', 'run', '-w', '@sb/db', 'migrate'], env);
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      'api',
      'npm',
      'run',
      '-w',
      '@sb/db',
      'seed',
      '--',
      '--scenario',
      'default',
    ],
    env,
  );
  compose(['up', '-d', '--no-deps', '--wait', 'api', 'worker', 'caddy'], env);
  run('npx', ['playwright', 'install', 'chromium']);
  mkdirSync(new URL('../../test-artifacts/e2e/', import.meta.url), { recursive: true });
  const test = spawnSync(
    'npx',
    ['playwright', 'test', '--config=tests/e2e/playwright.config.ts', ...process.argv.slice(2)],
    { cwd: root, stdio: 'inherit', env },
  );
  code = test.status ?? 1;
  if (code === 0 && !process.argv.slice(2).length) {
    compose(['stop', 'worker', 'api'], env);
    compose(
      [
        'run',
        '--rm',
        '--no-deps',
        'api',
        'npm',
        'run',
        '-w',
        '@sb/db',
        'seed',
        '--',
        '--scenario',
        'expiry-fast',
      ],
      env,
    );
    compose(['up', '-d', '--no-deps', '--wait', 'api', 'worker', 'caddy'], env);
    const expiry = spawnSync(
      'npx',
      ['playwright', 'test', '--config=tests/e2e/playwright.config.ts'],
      { cwd: root, stdio: 'inherit', env: { ...env, E2E_SCENARIO: 'expiry-fast' } },
    );
    code = expiry.status ?? 1;
  }
} finally {
  if (created) {
    compose(['stop', 'worker', 'api'], env);
    compose([
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'sb',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE ${database} WITH (FORCE)`,
    ]);
    // Return the demo to the normal live configuration even after a failed assertion.
    compose(['up', '-d', '--no-deps', '--wait', 'api', 'worker', 'caddy']);
  }
}
process.exitCode = code;
