import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/voice-completion.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'iife', globalName: 'Notice' });
const pcm = Buffer.alloc(24_000 * 2);
for (let i = 0; i < 24_000; i++)
  pcm.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 24_000) * 1000), i * 2);
const header = Buffer.alloc(44);
header.write('RIFF');
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(24_000, 24);
header.writeUInt32LE(48_000, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]).toString('base64');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<button id="start">Play synthetic notice</button>');
  await page.addScriptTag({ content: code });
  await page.evaluate((wav) => {
    window.results = { immediate: null, completed: null, cancelled: null };
    document.querySelector('#start').onclick = async () => {
      window.guard = new Notice.CompletionPlayback({
        taskId: 'task_test',
        inputRevision: 1,
        requestVersion: 1,
      });
      await window.guard.start(wav);
      window.results.immediate = window.guard.take();
    };
  }, wav);
  await page.click('#start');
  await page.waitForFunction(() => {
    window.results.completed = window.guard.take();
    return !!window.results.completed;
  });
  const first = await page.evaluate(() => window.results);
  if (first.immediate !== null || first.completed?.taskId !== 'task_test')
    throw new Error('NaturalPlaybackFailed');
  await page.click('#start');
  await page.waitForTimeout(100);
  await page.evaluate(() => window.guard.cancel());
  await page.waitForTimeout(1200);
  const cancelled = await page.evaluate(() => window.guard.take());
  if (cancelled !== null) throw new Error('CancelledPlaybackCompleted');
  const report = {
    browser: browser.version(),
    naturalEnded: true,
    playStartIsNotEnd: true,
    cancelDoesNotComplete: true,
    syntheticToneOnly: true,
  };
  const dir = new URL('../../../test-artifacts/agent-refactor/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('browser-playback.json', dir), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
