import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const files = await readdir(dist, { recursive: true });
const scripts = await Promise.all(
  files.filter((file) => file.endsWith('.js')).map((file) => readFile(new URL(file, dist), 'utf8')),
);
const bundle = scripts.join('\n');
for (const marker of [
  'sb-web-development-fixture-v1',
  'dev-browser-csrf',
  'mockServiceWorker.js',
  'Mock Service Worker',
])
  assert(!bundle.includes(marker), `Development-only code in production: ${marker}`);
assert(!files.includes('mockServiceWorker.js'));
const sw = await readFile(new URL('sw.js', dist), 'utf8');
assert(sw.includes('NetworkOnly'), 'API cache strategy must remain NetworkOnly');
assert(sw.includes('content/center/v1/catalog.json'), 'Public center catalog must be precached');
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
assert.equal(manifest.lang, 'ko');
assert.equal(manifest.display, 'standalone');
for (const size of [192, 512]) {
  assert(manifest.icons.some((icon) => icon.sizes === `${size}x${size}`));
  const png = await readFile(new URL(`icon-${size}.png`, dist));
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
const metadata = JSON.parse(
  await readFile(new URL('public/assets/item-metadata.json', root), 'utf8'),
);
assert.equal(metadata.length, 10);
for (const item of metadata) {
  assert.equal(item.src, `/assets/items/${item.id}.svg`);
  assert.equal((await stat(new URL(`public${item.src}`, root))).size, item.byteSize);
  assert.equal(item.decorative, false);
  assert(item.alt && item.creator && item.license);
}
const report = {
  passed: true,
  productionMockExcluded: true,
  apiCache: 'NetworkOnly',
  centerCatalogPrecached: true,
  pwaPngSizes: [192, 512],
  itemIllustrations: 10,
  metadataBytesVerified: true,
  generatedAt: new Date().toISOString(),
};
await mkdir(new URL('test-artifacts/', root), { recursive: true });
await writeFile(new URL('test-artifacts/build-audit.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
