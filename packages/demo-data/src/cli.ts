import { parseArgs } from 'node:util';
import { DemoScenarioSchema } from '@sb/contracts';
import { buildSeed } from './index.js';

try {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'default' },
      now: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      'Usage: npm run -w @sb/demo-data print -- --scenario default|expiry-fast|ineligible [--now RFC3339]',
    );
  } else {
    const scenario = DemoScenarioSchema.parse(values.scenario);
    const seed = buildSeed({ scenario, ...(values.now ? { now: values.now } : {}) });
    console.log(JSON.stringify(seed, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'seed fixture 생성 실패');
  process.exitCode = 1;
}
