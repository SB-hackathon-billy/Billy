import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifacts = new URL('../test-artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});
await context.grantPermissions([], { origin: 'http://127.0.0.1:5173' });
// Deterministic permission-denial fixture; this does not verify a real microphone.
await context.addInitScript(() => {
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    },
  });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const captures = [];
async function capture(name) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, artifacts)), fullPage: true });
  captures.push({ screen: name, url: page.url(), viewport: '390×844', horizontalOverflow: false });
  console.log('captured', name);
}
async function setCheck(locator, checked = true) {
  await expect(locator).toBeEnabled();
  if ((await locator.isChecked()) !== checked)
    await locator.locator('xpath=ancestor::label').click();
  await expect(locator).toBeChecked({ checked });
}
async function login(name) {
  await page.getByLabel('데모 아이디', { exact: true }).fill(`demo-${name}`);
  await page.getByRole('button', { name: '데모 시작하기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('오늘은 무엇이');
}
async function switchTo(name) {
  await page.getByRole('link', { name: '내 정보', exact: true }).click();
  await page.getByRole('button', { name: '아이디 전환', exact: true }).click();
  await expect(page.getByLabel('데모 아이디', { exact: true })).toBeVisible();
  await login(name);
}
try {
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByLabel('데모 아이디', { exact: true })).toBeVisible();
  await capture('E01-entry');
  await page.getByLabel('데모 아이디', { exact: true }).fill('demo-hana');
  await page.getByLabel('데모 아이디', { exact: true }).dispatchEvent('compositionstart');
  await page.getByLabel('데모 아이디', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/entry$/);
  await page.getByLabel('데모 아이디', { exact: true }).dispatchEvent('compositionend');
  await page.getByLabel('데모 아이디', { exact: true }).fill('not-a-demo');
  await page.getByRole('button', { name: '데모 시작하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('준비된 데모 아이디가 아니에요');
  await login('hana');
  await capture('H01-home');
  await page.getByRole('link', { name: /무엇이 필요하세요/ }).click();
  await page.getByRole('button', { name: /통화 시작/ }).click();
  await expect(page.getByRole('alert')).toContainText('마이크 권한이 꺼져 있어요');
  await capture('R01-microphone-denied');
  await page.getByRole('button', { name: '텍스트로 입력', exact: true }).click();
  await page
    .getByLabel('필요한 물품과 사용 계획')
    .fill(
      '프로젝터가 필요해요. 모레 오전 10시부터 다음 날 오후 4시까지, 센터 앞이나 도서관 앞에서 만나요.',
    );
  await page.getByRole('button', { name: '신청서 채우기', exact: true }).click();
  await page.getByRole('button', { name: '신청서 확인·수정', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('이렇게 찾아볼까요?');
  await capture('R02-summary');
  await page.getByRole('button', { name: '이 조건으로 찾아보기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('골라 요청');
  const requestUrl = page.url();
  for (const title of ['공공 프로젝터', '두리의 프로젝터', '슬의 프로젝터']) {
    await setCheck(page.getByRole('checkbox', { name: `${title} 선택`, exact: true }));
  }
  await capture('R03-candidates');
  await setCheck(page.getByRole('checkbox', { name: /선택한 주민에게 조건을 보내고/ }));
  await page.getByRole('button', { name: '이 후보들에게 요청 · 3개', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/기다리고|비교해/);
  await capture('R04-waiting');
  await switchTo('duri');
  await page.getByRole('link', { name: '요청함', exact: true }).click();
  await page.getByRole('button', { name: '빌려주기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 조건 승인', exact: true })).toBeVisible();
  await capture('O01-owner-request');
  await page.getByRole('button', { name: '이 조건 승인', exact: true }).click();
  await expect(page.locator('.owner-card .status')).toHaveText('조건 도착');
  await capture('O01-approved');
  await switchTo('seul');
  await page.getByRole('link', { name: '요청함', exact: true }).click();
  await page.getByRole('button', { name: '빌려주기', exact: true }).click();
  await page.getByRole('link', { name: '조건 변경 제안', exact: true }).click();
  await page.getByRole('button', { name: '변경 조건의 가격 확인', exact: true }).click();
  await expect(page.getByLabel('제안할 총 대여료')).toBeVisible();
  await page.getByLabel('제안할 총 대여료').selectOption('2500');
  await page.getByLabel('변경 사유').selectOption('PRICE_ADJUSTMENT');
  await capture('O01-counter-form');
  await page.getByRole('button', { name: '이 조건으로 변경 제안', exact: true }).click();
  await expect(page.locator('.owner-card .status')).toHaveText('조건 도착');
  await capture('O01-counter-sent');
  await switchTo('hana');
  await page.goto(requestUrl);
  await expect(page.getByRole('link', { name: '이 조건 선택하기', exact: true })).toHaveCount(3);
  await capture('R04-comparison');
  const duri = page
    .locator('.comparison-card')
    .filter({ has: page.getByRole('heading', { name: '두리의 프로젝터', exact: true }) });
  await duri.getByRole('link', { name: '조건 수정 제안', exact: true }).click();
  await page.getByLabel('시작 시각', { exact: true }).selectOption('10:30');
  await page.getByLabel('만남 장소', { exact: true }).selectOption('place-library');
  await page.getByRole('button', { name: '변경 조건의 가격 확인', exact: true }).click();
  await page.getByLabel('제안할 총 대여료').selectOption('4500');
  await capture('R05-requester-counter');
  await page.getByRole('button', { name: '이 조건으로 변경 제안', exact: true }).click();
  await expect(
    page
      .locator('.comparison-card')
      .filter({ has: page.getByRole('heading', { name: '두리의 프로젝터', exact: true }) })
      .getByRole('link', { name: '이 조건 선택하기', exact: true }),
  ).toHaveCount(0);
  await capture('R04-counter-awaiting-owner');
  await switchTo('duri');
  await page.getByRole('link', { name: '요청함', exact: true }).click();
  await page.getByRole('button', { name: '빌려주기', exact: true }).click();
  await page.getByRole('button', { name: '이 조건 승인', exact: true }).click();
  await expect(page.locator('.owner-card .status')).toHaveText('조건 도착');
  await switchTo('hana');
  await page.goto(requestUrl);
  await expect(page.getByRole('link', { name: '이 조건 선택하기', exact: true })).toHaveCount(3);
  await setCheck(page.getByRole('checkbox', { name: '차이만 보기', exact: true }));
  await expect(page.getByText('총 대여료 변경', { exact: false })).toHaveCount(2);
  await capture('R04-differences');
  await setCheck(page.getByRole('checkbox', { name: '차이만 보기', exact: true }), false);
  const seul = page
    .locator('.comparison-card')
    .filter({ has: page.getByRole('heading', { name: '슬의 프로젝터', exact: true }) });
  await seul.getByRole('link', { name: '이 조건 선택하기', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '선택하고 결제 미리보기', exact: true }),
  ).toBeDisabled();
  await capture('R05-final-confirm');
  await setCheck(page.getByRole('checkbox', { name: /물품·기간·장소·총액을 확인했고/ }));
  await page.getByRole('button', { name: '선택하고 결제 미리보기', exact: true }).click();
  await expect(page.getByText('결제 화면 준비 완료', { exact: true })).toBeVisible();
  await expect(
    page.getByText('실제 결제와 예약이 이루어지지 않습니다.', { exact: true }),
  ).toBeVisible();
  await capture('R06-payment-preview');
  await page.getByRole('link', { name: '데모 확인 완료', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await switchTo('duri');
  await page.getByRole('link', { name: '요청함', exact: true }).click();
  await page.getByRole('button', { name: '빌려주기', exact: true }).click();
  await expect(page.getByText('다른 물품 선택으로 종료', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이 조건 승인', exact: true })).toHaveCount(0);
  await capture('O01-superseded');
  await switchTo('hana');
  await page.getByRole('link', { name: '공유대여', exact: true }).click();
  await page.getByRole('button', { name: '텍스트로 입력', exact: true }).click();
  await page
    .getByLabel('필요한 물품과 사용 계획')
    .fill('청소기가 필요해요. 모레 오전 10시부터 다음 날 오후 4시까지 센터 앞에서 만나요.');
  await page.getByRole('button', { name: '신청서 채우기', exact: true }).click();
  await page.getByRole('button', { name: '신청서 확인·수정', exact: true }).click();
  await page.getByRole('button', { name: '이 조건으로 찾아보기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('골라 요청');
  const declineUrl = page.url();
  await setCheck(page.getByRole('checkbox', { name: '두리의 청소기 선택', exact: true }));
  await setCheck(page.getByRole('checkbox', { name: /선택한 주민에게 조건을 보내고/ }));
  await page.getByRole('button', { name: '이 후보들에게 요청 · 1개', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('기다리고');
  await switchTo('duri');
  await page.getByRole('link', { name: '요청함', exact: true }).click();
  await page.getByRole('button', { name: '빌려주기', exact: true }).click();
  const cleaner = page
    .locator('.owner-card')
    .filter({ has: page.getByRole('heading', { name: '두리의 청소기', exact: true }) });
  await cleaner.getByRole('button', { name: '거절 사유 선택', exact: true }).click();
  await cleaner.getByLabel('거절 사유').selectOption('SCHEDULE_ADJUSTMENT');
  await cleaner.getByRole('button', { name: '이 요청 거절', exact: true }).click();
  await expect(cleaner.locator('.status')).toHaveText('거절됨');
  await capture('O01-declined');
  await switchTo('hana');
  await page.goto(declineUrl);
  await expect(page.getByText('제안 종료', { exact: true })).toBeVisible();
  await capture('R04-no-offers');
  await context.setOffline(true);
  await expect(page.getByText('오프라인 상태예요.', { exact: true })).toBeVisible();
  await capture('offline-guidance');
  await context.setOffline(false);
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join('; ')}`);
  await writeFile(
    new URL('flow-results.json', artifacts),
    JSON.stringify(
      {
        passed: true,
        captures,
        browserExceptions: errors,
        limits:
          'Development MSW flow; no real microphone, server, device, or OpenAI quality verification.',
      },
      null,
      2,
    ),
  );
  console.log('PASS mobile flow', captures.length, 'screens');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(0, 9000));
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', artifacts)), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
