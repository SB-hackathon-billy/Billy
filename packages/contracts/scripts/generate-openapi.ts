import { writeFile } from 'node:fs/promises';
import { API_OPERATIONS, buildOpenApi } from '../src/openapi.js';

const output = new URL('../openapi.json', import.meta.url);
await writeFile(output, JSON.stringify(buildOpenApi(), null, 2) + '\n');
console.log(`Generated ${output.pathname}: ${API_OPERATIONS.length} operations`);
