import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function screenshot(page: Page, name: string) {
  mkdirSync('test-artifacts/e2e/screenshots', { recursive: true });
  await page.screenshot({ path: `test-artifacts/e2e/screenshots/${name}.png`, fullPage: true });
}
export async function audit(page: Page, name: string, info: TestInfo) {
  const result = await new AxeBuilder({ page }).analyze();
  const report = { page: name, violations: result.violations, passes: result.passes.length };
  mkdirSync('test-artifacts/e2e/axe', { recursive: true });
  writeFileSync(`test-artifacts/e2e/axe/${name}.json`, JSON.stringify(report, null, 2));
  await info.attach(`axe-${name}`, {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
  expect(result.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
}
// The requester journey uses real Tab/Enter/Space keys, including reaching every control.
export async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 160; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(
    `Keyboard could not reach ${(await target.getAttribute('aria-label')) ?? (await target.textContent())}`,
  );
}
export async function activate(page: Page, target: Locator, key = 'Enter') {
  await tabTo(page, target);
  await page.keyboard.press(key);
}
export async function type(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
}
export async function choose(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  // macOS headless Chromium cannot operate its native popup with Arrow keys.
  // This owner-only helper selects the visible native option; no API is called here.
  await target.selectOption(value);
  await expect(target).toHaveValue(value);
}
export async function enter(page: Page, handle: string) {
  await page.goto('/entry');
  await type(
    page,
    page.getByRole('textbox', { name: '데모 아이디', exact: true }),
    `demo-${handle}`,
  );
  await activate(page, page.getByRole('button', { name: '데모 시작하기', exact: true }));
  await expect(page).toHaveURL('http://localhost:8000/');
}
export async function observeSse(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  const messages: { type: string; receivedAt: number }[] = [];
  client.on('Network.eventSourceMessageReceived', (event) =>
    messages.push({ type: event.eventName, receivedAt: Date.now() }),
  );
  return messages;
}
