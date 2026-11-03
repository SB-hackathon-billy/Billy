import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(
  readFileSync(new URL('./module-1-baseline.json', import.meta.url), 'utf8'),
);
if (baseline.version !== 1 || Object.keys(baseline.files ?? {}).length === 0) {
  throw new Error('Invalid module 1 baseline; do not bypass the boundary check.');
}

const failures = [];
for (const [path, expected] of Object.entries(baseline.files)) {
  const file = resolve(root, path);
  const local = relative(root, file);
  if (isAbsolute(local) || local.startsWith('..') || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`Invalid baseline entry: ${path}`);
  }
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      failures.push(`${path}: regular file required`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== expected) failures.push(`${path}: changed`);
  } catch (error) {
    if (error.code === 'ENOENT') failures.push(`${path}: missing or moved`);
    else throw error;
  }
}

if (failures.length) {
  console.error('Module 1 is protected. These files differ from the preserved implementation:');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    'See docs/current/MODULE_BOUNDARIES.md. Do not regenerate hashes to bypass this check.',
  );
  process.exitCode = 1;
} else {
  console.log(`Module 1: ${Object.keys(baseline.files).length} protected files unchanged.`);
  console.log(
    'Shared-code behavior still requires the impact review and regression tests in the spec.',
  );
}
