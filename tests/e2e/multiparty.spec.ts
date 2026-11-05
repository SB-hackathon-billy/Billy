import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { activate, audit, choose, enter, observeSse, screenshot, tabTo, type } from './helpers';

test('AT04/07/13/14/19/22: three cookie stores, real server, keyboard journey and SSE recovery', async ({
  browser,
}, info) => {
  const options = {
    baseURL: 'http://localhost:8000',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  };
  const contexts = await Promise.all([
    browser.newContext(options),
    browser.newContext(options),
    browser.newContext(options),
  ]);
  const [hanaContext, duriContext, seulContext] = contexts;
  let hana = await hanaContext!.newPage();
  const duri = await duriContext!.newPage();
  const seul = await seulContext!.newPage();
  const errors: string[] = [];
  for (const context of contexts)
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  try {
    await Promise.all([enter(hana, 'hana'), enter(duri, 'duri'), enter(seul, 'seul')]);
    await screenshot(hana, '01-home');
    const cookies = await Promise.all(contexts.map((context) => context.cookies()));
    expect(
      new Set(cookies.map((list) => list.find((cookie) => cookie.name === 'demo_session')!.value))
        .size,
    ).toBe(3);
    for (const list of cookies)
      expect(list.find((cookie) => cookie.name === 'demo_session')).toMatchObject({
        secure: false,
        httpOnly: true,
        sameSite: 'Lax',
      });
    await activate(duri, duri.getByRole('link', { name: '요청함', exact: true }));
    await activate(duri, duri.getByRole('button', { name: '빌려주기', exact: true }));
    await activate(seul, seul.getByRole('link', { name: '요청함', exact: true }));
    await activate(seul, seul.getByRole('button', { name: '빌려주기', exact: true }));

    const hanaEvents = await observeSse(hana);
    const duriEvents = await observeSse(duri);
    await activate(hana, hana.getByRole('link', { name: '공유대여', exact: true }));
    await activate(hana, hana.getByRole('link', { name: '텍스트로 입력하기', exact: true }));
    await activate(hana, hana.getByRole('button', { name: '텍스트로 입력', exact: true }));
    await type(
      hana,
      hana.getByRole('textbox', { name: '필요한 물품과 사용 계획' }),
      '모레 오전 10시부터 다음날 오후 4시까지 프로젝터 빌리고 싶어요, 장소는 아무 데나',
    );
    await activate(hana, hana.getByRole('button', { name: '신청서 채우기' }));
    await expect(hana.getByRole('heading', { name: '대여 신청서' })).toBeVisible();
    await screenshot(hana, '02-text-summary');
    await activate(hana, hana.getByRole('button', { name: '신청서 확인·수정' }));
    await expect(hana.getByRole('heading', { name: '이렇게 찾아볼까요?' })).toBeVisible();
    await expect(hana.getByRole('textbox', { name: '필요한 물품', exact: true })).toHaveValue(
      '프로젝터',
    );
    await screenshot(hana, '03-need-review');
    await audit(hana, 'need-review', info);
    await activate(hana, hana.getByRole('button', { name: '이 조건으로 찾아보기' }));
    await expect(hana.locator('.candidate')).toHaveCount(3);
    for (const title of ['공공 프로젝터', '두리의 프로젝터', '슬의 프로젝터']) {
      await activate(
        hana,
        hana.getByRole('checkbox', { name: `${title} 선택`, exact: true }),
        'Space',
      );
    }
    await activate(
      hana,
      hana.getByRole('checkbox', {
        name: '선택한 주민에게 조건을 보내고, 공공 물품에는 센터 데모 신청을 보냅니다.',
      }),
      'Space',
    );
    await screenshot(hana, '04-three-candidates');
    await tabTo(hana, hana.getByRole('button', { name: '이 후보들에게 요청 · 3개' }));
    const submittedAt = Date.now();
    await hana.keyboard.press('Enter');
    await expect(duri.getByRole('heading', { name: '두리의 프로젝터', exact: true })).toBeVisible({
      timeout: 2000,
    });
    const requestToOwnerMs = Date.now() - submittedAt;
    expect(requestToOwnerMs).toBeLessThanOrEqual(2000);
    expect(
      duriEvents.some(
        (event) => event.type === 'negotiation.created' && event.receivedAt >= submittedAt,
      ),
    ).toBe(true);
    await expect(duri.getByRole('heading', { name: '슬의 프로젝터', exact: true })).toHaveCount(0);
    await expect(seul.getByRole('heading', { name: '두리의 프로젝터', exact: true })).toHaveCount(
      0,
    );
    await expect(
      hana
        .locator('.comparison-card')
        .filter({ hasText: '공공 프로젝터' })
        .getByText('조건 도착', { exact: true }),
    ).toBeVisible();
    await screenshot(duri, '05-owner-request');
    await activate(duri, duri.getByRole('link', { name: '조건 변경 제안', exact: true }));
    await choose(
      duri,
      duri.getByRole('combobox', { name: '만남 장소', exact: true }),
      'place-library',
    );
    await activate(duri, duri.getByRole('button', { name: '변경 조건의 가격 확인' }));
    await choose(duri, duri.getByRole('combobox', { name: '제안할 총 대여료' }), '4500');
    await choose(duri, duri.getByRole('combobox', { name: '변경 사유' }), 'PRICE_ADJUSTMENT');
    await screenshot(duri, '06-owner-counter');
    await tabTo(duri, duri.getByRole('button', { name: '이 조건으로 변경 제안' }));
    const changedAt = Date.now();
    await duri.keyboard.press('Enter');
    const duriRow = hana.locator('.comparison-card').filter({ hasText: '두리의 프로젝터' });
    await expect(duriRow.locator('.terms')).toContainText('4,500원', { timeout: 2000 });
    const ownerToRequesterMs = Date.now() - changedAt;
    expect(ownerToRequesterMs).toBeLessThanOrEqual(2000);
    expect(
      hanaEvents.some(
        (event) => event.type === 'negotiation.updated' && event.receivedAt >= changedAt,
      ),
    ).toBe(true);
    await expect(duriRow.locator('.terms')).toContainText('도서관 앞');
    await expect(duriRow.locator('.terms')).toContainText('총 대여료 변경');
    await expect(duriRow.locator('.terms')).toContainText('만남 장소 변경');

    // AT13: no requester page is open while another real UI actor responds.
    const requestUrl = hana.url();
    await hana.close();
    await activate(seul, seul.getByRole('button', { name: '이 조건 승인', exact: true }));
    await expect(seul.getByText('조건 도착', { exact: true })).toBeVisible();
    hana = await hanaContext!.newPage();
    await hana.goto('/');
    await activate(hana, hana.locator('.request-link').filter({ hasText: '프로젝터' }).first());
    await expect(hana).toHaveURL(requestUrl);
    await expect(
      hana.locator('.comparison-card').getByText('조건 도착', { exact: true }),
    ).toHaveCount(3);
    await expect(
      hana.locator('.comparison-card').filter({ hasText: '슬의 프로젝터' }).locator('.terms'),
    ).toContainText('3,000원');
    await activate(hana, hana.getByRole('checkbox', { name: '차이만 보기', exact: true }), 'Space');
    await screenshot(hana, '07-comparison-differences-restored');
    await audit(hana, 'comparison', info);
    await activate(
      hana,
      hana
        .locator('.comparison-card')
        .filter({ hasText: '두리의 프로젝터' })
        .getByRole('link', { name: '이 조건 선택하기' }),
    );
    await activate(
      hana,
      hana.getByRole('checkbox', {
        name: '물품·기간·장소·총액을 확인했고, 다른 활성 후보 요청을 종료하는 데 동의합니다.',
      }),
      'Space',
    );
    await screenshot(hana, '08-selection-review');
    const selected = hana.waitForResponse(
      (response) => response.url().endsWith('/select') && response.request().method() === 'POST',
    );
    await activate(hana, hana.getByRole('button', { name: '선택하고 결제 미리보기' }));
    const result = await (await selected).json();
    expect(result.data.paymentPreview).toMatchObject({
      totalFeeKrw: 4500,
      mode: 'PREVIEW_ONLY',
      chargeable: false,
      paymentStatus: 'NOT_APPLICABLE',
    });
    expect(
      result.data.request.negotiations.map((branch: { status: string }) => branch.status).sort(),
    ).toEqual(['SELECTED', 'SUPERSEDED', 'SUPERSEDED']);
    await expect(hana.locator('.payment-total')).toHaveText('데모 총 대여료4,500원');
    await expect(
      hana.getByText('실제 결제와 예약이 이루어지지 않습니다.', { exact: true }),
    ).toBeVisible();
    await expect(duri.getByText('선택됨', { exact: true })).toBeVisible();
    await expect(seul.getByText('다른 물품 선택으로 종료', { exact: true })).toBeVisible();
    await screenshot(hana, '09-payment-preview');
    await audit(hana, 'payment-preview', info);
    const paymentMutations: string[] = [];
    hana.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
        paymentMutations.push(new URL(request.url()).pathname);
    });
    await tabTo(hana, hana.getByRole('radio', { name: '데모 카드 · 청구되지 않음' }));
    await hana.keyboard.press('ArrowDown');
    await expect(hana.getByRole('radio', { name: '데모 간편결제 · 청구되지 않음' })).toBeChecked();
    await activate(hana, hana.getByRole('link', { name: '데모 확인 완료', exact: true }));
    expect(paymentMutations).toEqual([]);

    // AT14: same cookie store rotates identity and must not retain the requester's data.
    await activate(hana, hana.getByRole('link', { name: '내 정보', exact: true }));
    await activate(hana, hana.getByRole('button', { name: '아이디 전환', exact: true }));
    await expect(hana).toHaveURL(/\/entry$/);
    await enter(hana, 'jun');
    await expect(hana.locator('.request-link')).toHaveCount(0);
    await hana.goto(requestUrl);
    await expect(hana.getByRole('alert')).toContainText(
      '내용을 찾을 수 없거나 이 아이디로 볼 수 없어요.',
    );
    await expect(hana.locator('.comparison-card, .payment-total')).toHaveCount(0);
    await screenshot(hana, '10-identity-isolation');
    const evidence = {
      viewport: '390x844',
      aiMode: 'fixture',
      transport: 'HTTP + PostgreSQL + pg-boss + SSE',
      requestToOwnerMs,
      ownerToRequesterMs,
      keyboardCoreJourney: true,
      requesterClosedRestoration: true,
      isolatedCookieStores: 3,
    };
    writeFileSync('test-artifacts/e2e/multiparty.json', JSON.stringify(evidence, null, 2));
    console.log(
      `SSE UI latency: requester → owner ${requestToOwnerMs} ms; owner → requester ${ownerToRequesterMs} ms`,
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
