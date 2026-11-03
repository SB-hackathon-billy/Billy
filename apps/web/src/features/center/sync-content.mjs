import { readFile, writeFile } from 'node:fs/promises';

// Public JSON remains the editable source; Vite only imports the generated snapshot.
const source = new URL('../../../public/content/center/v1/catalog.json', import.meta.url);
const target = new URL('./catalog.generated.json', import.meta.url);
const content = JSON.parse(await readFile(source, 'utf8'));
await writeFile(target, `${JSON.stringify(content, null, 2)}\n`);
console.log(`Generated center snapshot: ${content.items.length} entries`);
