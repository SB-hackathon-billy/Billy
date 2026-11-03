import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { activate, audit, enter, screenshot, type } from './helpers';

test('AT20: all six center menus and preview forms perform no mutation', async ({ page }, info) => {
  const writes: { method: string; path: string }[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      writes.push({ method: request.method(), path: new URL(request.url()).pathname });
  });
  await page.goto('/center');
  await expect(page.getByRole('navigation', { name: '센터 메뉴' }).getByRole('link')).toHaveCount(
    6,
  );
  await audit(page, 'center-about', info);
  const menu = page.getByRole('navigation', { name: '센터 메뉴' });
  await menu.getByRole('link', { name: '사업 안내', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '사업 검색' })).toBeVisible();
  await menu.getByRole('link', { name: '프로그램', exact: true }).click();
  await page.locator('.center-card-list a').first().click();
  await page.getByRole('button', { name: '신청 양식 살펴보기' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '신청 미리보기', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('전송·접수·저장되지 않은 미리보기입니다.');
  await screenshot(page, '11-program-preview');
  await audit(page, 'program-preview', info);
  await page.getByRole('button', { name: '미리보기 닫기' }).last().click();
  await menu.getByRole('link', { name: '동아리', exact: true }).click();
  await page.locator('.center-card-list a').first().click();
  for (const name of ['리더 참여 양식', '팀원 참여 양식', '활동보고 양식']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: name === '활동보고 양식' ? '활동보고 미리보기' : '신청 미리보기',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText('전송·접수·저장되지 않은 미리보기입니다.');
    await screenshot(
      page,
      `12-club-${name === '리더 참여 양식' ? 'leader' : name === '팀원 참여 양식' ? 'member' : 'report'}`,
    );
    await page.getByRole('button', { name: '미리보기 닫기' }).last().click();
  }
  await menu.getByRole('link', { name: '공간', exact: true }).click();
  await page.locator('a[href^="/center/spaces/"]').first().click();
  await page.getByRole('button', { name: '예약 미리보기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('예약·승인·출입 권한은 생성되지 않습니다.');
  await screenshot(page, '13-space-preview');
  await audit(page, 'space-preview', info);
  await page.getByRole('button', { name: '미리보기 닫기' }).last().click();
  await menu.getByRole('link', { name: '소식', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '소식 제목 검색' })).toBeVisible();
  expect(writes).toEqual([]);
  writeFileSync(
    'test-artifacts/e2e/center-network.json',
    JSON.stringify({ mutations: writes, menus: 6, previews: 5 }, null, 2),
  );
});

test('AT22/PWA: denied microphone, offline controls, public-only caches and installability', async ({
  page,
  context,
}, info) => {
  await page.goto('/entry');
  await audit(page, 'entry', info);
  await enter(page, 'jun');
  await activate(page, page.getByRole('link', { name: '공유대여', exact: true }));
  const client = await context.newCDPSession(page);
  await context.grantPermissions([], { origin: 'http://localhost:8000' });
  expect(
    await page.evaluate(
      async () =>
        (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state,
    ),
  ).toBe('denied');
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await activate(page, page.getByRole('button', { name: /통화 시작/ }));
  await expect(page.getByRole('alert')).toContainText('마이크 권한이 꺼져 있어요.');
  expect(writes).toEqual([]);
  await activate(page, page.getByRole('button', { name: '텍스트로 입력', exact: true }));
  await type(
    page,
    page.getByRole('textbox', { name: '필요한 물품과 사용 계획' }),
    '프로젝터가 필요해요',
  );
  await screenshot(page, '14-microphone-denied');
  await audit(page, 'microphone-denied', info);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cacheUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
    return urls;
  });
  expect(cacheUrls.length).toBeGreaterThan(0);
  expect(cacheUrls.filter((url) => new URL(url).pathname.startsWith('/api'))).toEqual([]);
  expect(cacheUrls.some((url) => url.includes('/content/center/'))).toBe(true);
  const manifest = await page.evaluate(async () =>
    (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json(),
  );
  expect(manifest).toMatchObject({ lang: 'ko', display: 'standalone', start_url: '/', scope: '/' });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512' }),
    ]),
  );
  const iconSizes = await page.evaluate(async () =>
    Promise.all(
      ['/icon-192.png', '/icon-512.png'].map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }),
    ),
  );
  expect(iconSizes).toEqual([
    [192, 192],
    [512, 512],
  ]);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  const installability = await client.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  writeFileSync(
    'test-artifacts/e2e/pwa.json',
    JSON.stringify(
      { cacheUrls, manifest, iconSizes, installability, secureContext: true },
      null,
      2,
    ),
  );
  await activate(page, page.getByRole('button', { name: '텍스트로 입력', exact: true }));
  await type(
    page,
    page.getByRole('textbox', { name: '필요한 물품과 사용 계획' }),
    '프로젝터가 필요해요',
  );
  const beforeOffline = writes.length;
  await context.setOffline(true);
  await expect(page.getByText('오프라인 상태예요.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '신청서 채우기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /통화 시작/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '직접 조건 작성하기' })).toBeDisabled();
  await screenshot(page, '15-offline-controls');
  await page.getByRole('link', { name: '저장된 센터 안내 보기' }).click();
  await expect(page.getByRole('heading', { name: '혼자여도, 함께하는 일상' })).toBeVisible();
  await screenshot(page, '16-offline-center');
  await context.setOffline(false);
  await expect(page.getByText('오프라인 상태예요.', { exact: true })).toHaveCount(0);
  expect(writes.length).toBe(beforeOffline);
});
