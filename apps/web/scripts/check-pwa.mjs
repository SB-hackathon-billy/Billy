import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifacts = new URL('../test-artifacts/', import.meta.url);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'ko-KR',
});
const page = await context.newPage();
try {
  await page.goto('http://127.0.0.1:5173/center');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Service worker not ready')), 10000),
      ),
    ]),
  );
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const onlineTitle = await page.locator('h1').innerText();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText(onlineTitle);
  await expect(page.getByText('오프라인 상태예요.', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cachePaths = [];
    for (const name of cacheNames)
      for (const request of await (await caches.open(name)).keys())
        cachePaths.push(new URL(request.url).pathname);
    const apiRejectedOffline = await fetch('/api/v1/me').then(
      () => false,
      () => true,
    );
    return {
      cacheNames,
      cachePaths,
      apiRejectedOffline,
      privateDataCached: cachePaths.some((path) => path.startsWith('/api/')),
      worker: navigator.serviceWorker.controller.scriptURL,
    };
  });
  expect(result.apiRejectedOffline).toBe(true);
  expect(result.privateDataCached).toBe(false);
  expect(result.cachePaths).toContain('/content/center/v1/catalog.json');
  await page.screenshot({
    path: fileURLToPath(new URL('pwa-offline-center.png', artifacts)),
    fullPage: true,
  });
  await writeFile(
    new URL('pwa-runtime-results.json', artifacts),
    JSON.stringify({ passed: true, offlineCenterTitle: onlineTitle, ...result }, null, 2),
  );
  console.log(
    'PASS production PWA: offline shell + public center; API fails offline; no API CacheStorage entries',
  );
} finally {
  await browser.close();
}
