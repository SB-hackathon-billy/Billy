import { compose, run } from './common.mjs';

const [action, ...args] = process.argv.slice(2);
if (action === 'down') {
  // Shared PostgreSQL and its volume belong to every worker; keep them running.
  run('docker', ['compose', 'stop', 'caddy', 'worker', 'api']);
} else if (action === 'up') {
  run('npm', ['run', 'build']);
  compose(['up', '-d', '--no-recreate', '--wait', 'db']);
  compose(['build', 'api']);
  compose(['run', '--rm', '--no-deps', 'api', 'npm', 'run', '-w', '@sb/db', 'migrate']);
  compose(['up', '-d', '--no-deps', '--wait', 'api', 'worker', 'caddy']);
  run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--retry',
    '10',
    '--retry-connrefused',
    '--retry-delay',
    '1',
    '--output',
    '/dev/null',
    'http://localhost:8000/api/v1/places',
  ]);
  console.log('준비 완료: http://localhost:8000 · fixture 적재: npm run seed');
} else if (action === 'seed') {
  // Explicit local CLI only. Stop queue consumers while replacing demo fixtures.
  compose(['stop', 'worker']);
  try {
    compose([
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
      ...args,
    ]);
  } finally {
    compose(['up', '-d', '--no-deps', '--wait', 'worker']);
  }
} else {
  throw new Error('사용법: node infra/scripts/stack.mjs up|down|seed');
}
