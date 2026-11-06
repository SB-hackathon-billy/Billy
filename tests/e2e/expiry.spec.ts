import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { activate, enter, screenshot } from './helpers';

test('AT19: a real 30-second hold expires without a payment or reservation mutation', async ({
  page,
}) => {
  await enter(page, 'hana');
  await expect(page.getByText('빠른 만료 시연', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '공유대여', exact: true }).click();
  // 명세 0003: /rental은 통화 화면, 텍스트 접수는 /rental/classic.
  await page.getByRole('link', { name: '텍스트로 입력하기', exact: true }).click();
  await page.getByRole('button', { name: '텍스트로 입력' }).click();
  await page
    .getByRole('textbox', { name: '필요한 물품과 사용 계획' })
    .fill('모레 오전 10시부터 다음날 오후 4시까지 프로젝터가 필요해요. 장소는 아무 데나');
  await page.getByRole('button', { name: '신청서 채우기' }).click();
  await page.getByRole('button', { name: '신청서 확인·수정' }).click();
  await page.getByRole('button', { name: '이 조건으로 찾아보기' }).click();
  await activate(
    page,
    page.getByRole('checkbox', { name: '공공 프로젝터 선택', exact: true }),
    'Space',
  );
  await activate(
    page,
    page.getByRole('checkbox', {
      name: '선택한 주민에게 조건을 보내고, 공공 물품에는 센터 신청을 보냅니다.',
    }),
    'Space',
  );
  await page.getByRole('button', { name: '이 후보들에게 요청 · 1개' }).click();
  await page.getByRole('link', { name: '이 조건 선택하기' }).click();
  await activate(
    page,
    page.getByRole('checkbox', {
      name: '물품·기간·장소·총액을 확인했고, 다른 활성 후보 요청을 종료하는 데 동의합니다.',
    }),
    'Space',
  );
  await page.getByRole('button', { name: '선택하고 결제 미리보기' }).click();
  await expect(page.getByText('데모 선택 유효시간', { exact: true })).toBeVisible();
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      mutations.push(new URL(request.url()).pathname);
  });
  await screenshot(page, '17-fast-hold-active');
  await expect(page.getByText('데모 선택 유효시간 종료', { exact: true })).toBeVisible({
    timeout: 40_000,
  });
  const restored = page.waitForResponse(
    (response) =>
      response.url().endsWith('/payment-preview') && response.request().method() === 'GET',
  );
  await page.reload();
  const data = (await (await restored).json()).data;
  expect(data).toMatchObject({
    demoHoldStatus: 'EXPIRED',
    paymentStatus: 'NOT_APPLICABLE',
    chargeable: false,
    mode: 'PREVIEW_ONLY',
    totalFeeKrw: 3000,
  });
  await expect(page.getByText('데모 선택 유효시간 종료', { exact: true })).toBeVisible();
  await screenshot(page, '18-fast-hold-expired');
  expect(mutations).toEqual([]);
  writeFileSync(
    'test-artifacts/e2e/hold-expiry.json',
    JSON.stringify(
      {
        demoHoldStatus: data.demoHoldStatus,
        paymentStatus: data.paymentStatus,
        mutations,
        simulatedClock: false,
      },
      null,
      2,
    ),
  );
});
