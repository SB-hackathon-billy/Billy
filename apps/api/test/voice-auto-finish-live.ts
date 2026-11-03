/** Synthetic microphone through real Live/Decisions/Responses, private DB only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createTestDatabase } from '@sb/db';
import { createAiPorts } from '@sb/ai';
import { buildApi } from '../src/index.js';
import { RentalWorker } from '../../worker/src/worker.js';

process.env.AI_MODE = 'live';
process.env.VITE_API_TARGET = 'http://127.0.0.1:3103';
delete process.env.VITE_API_MOCK;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = resolve(root, 'test-artifacts/agent-refactor');
await mkdir(dir, { recursive: true });
const wavPath = resolve(dir, 'complete-input.wav');
const script =
  '다음 주 토요일 오전 열 시부터 오후 네 시까지 프로젝터 한 개를 빌리고 싶어요. 만나는 장소는 센터 앞이고 예산 제한은 없어요.';
try {
  await readFile(wavPath);
} catch {
  // Same synthetic-fixture generator as voice-live.ts; never a product model fallback.
  const tts = await new OpenAI({ maxRetries: 0 }).audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    input: script,
    instructions: '한국어로 자연스럽고 또렷하게 말하세요.',
    response_format: 'pcm',
  });
  const pcm = Buffer.concat([
    Buffer.alloc(24_000 * 2 * 12),
    Buffer.from(await tts.arrayBuffer()),
    Buffer.alloc(24_000 * 2 * 100),
  ]);
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
  await writeFile(wavPath, Buffer.concat([header, pcm]));
}
const test = await createTestDatabase();
const app = await buildApi({
  db: test.db,
  appOrigin: 'http://127.0.0.1:5175',
  cookieName: 'voice_auto_dev',
  cookieSecure: false,
  rateLimitMax: 10000,
});
const worker = new RentalWorker({ db: test.db, ai: createAiPorts() });
const vite = await createServer({
  root: resolve(root, 'apps/web'),
  configFile: resolve(root, 'apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  synthetic: true,
  limitations: 'Desktop Chromium synthetic microphone only; human speech and phones unverified.',
  models: {
    voice: process.env.OPENAI_VOICE_MODEL ?? 'gpt-live-1',
    agent: process.env.OPENAI_AGENT_MODEL ?? 'gpt-6.1-terra',
    decision: process.env.OPENAI_DECISION_MODEL ?? 'gpt-6-luna',
  },
};
const diagnostics: Record<string, unknown>[] = [];
app.log.info = ((data: Record<string, unknown>, message: string) => {
  if (message === 'voice.completion_audio' && diagnostics.length < 50) {
    const { voiceSessionId: _id, ...metrics } = data;
    diagnostics.push(metrics);
  }
}) as typeof app.log.info;
report.audioDiagnostics = diagnostics;
let requestId: string | undefined;
try {
  await app.listen({ host: '127.0.0.1', port: 3103 });
  await worker.start();
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
    ],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const counts = { clipResponses: 0, finishRequests: 0, finishStatus: 0 };
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/finish')) {
      counts.finishRequests++;
      report.finishAt = Date.now();
    }
  });
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() === 'POST' &&
      path.endsWith('/requests') &&
      response.status() === 201
    )
      requestId = (await response.json()).data.request.id;
    if (path.endsWith('/completion-audio') && response.status() === 200) {
      const data = (await response.json()).data;
      if (data.audioWav) counts.clipResponses++;
    }
    if (path.endsWith('/finish')) counts.finishStatus = response.status();
  });
  await page.addInitScript(() => {
    const metrics = { noticeStarted: 0, noticeEnded: 0, endedAt: 0 };
    Object.assign(window, { __noticeMetrics: metrics });
    const OriginalAudio = window.Audio;
    window.Audio = function (src?: string) {
      const audio = new OriginalAudio(src);
      if (src?.startsWith('data:audio/wav')) {
        audio.addEventListener('playing', () => metrics.noticeStarted++);
        audio.addEventListener('ended', () => {
          metrics.noticeEnded++;
          metrics.endedAt = Date.now();
        });
      }
      return audio;
    } as typeof Audio;
  });
  await page.goto('http://127.0.0.1:5175/entry');
  await page.getByRole('textbox', { name: '데모 아이디' }).fill('demo-hana');
  await page.getByRole('button', { name: '데모 시작하기' }).click();
  await page.waitForURL('http://127.0.0.1:5175/');
  await page.goto('http://127.0.0.1:5175/rental');
  await page.getByRole('button', { name: /통화 시작/ }).click();
  try {
    // Never click finish: successful navigation must originate from the playback callback.
    await page.waitForURL('**/inbox?role=REQUESTER', { timeout: 110_000 });
    if (!requestId) throw new Error('RequestMissing');
    await expect
      .poll(
        async () =>
          (await test.db.transaction((u) => u.getRequest('u_hana', requestId!))).request.status,
        { timeout: 45_000 },
      )
      .not.toBe('DRAFT');
    const metrics = await page.evaluate(
      () =>
        (
          window as unknown as {
            __noticeMetrics: { noticeStarted: number; noticeEnded: number; endedAt: number };
          }
        ).__noticeMetrics,
    );
    const view = await test.db.transaction((u) => u.getRequest('u_hana', requestId!));
    const final = await test.db.pool.query(
      "SELECT count(*)::int AS count FROM agent_tasks WHERE request_id=$1 AND context->>'finalizeAfterCall'='true'",
      [requestId],
    );
    report.playback = metrics;
    report.counts = counts;
    report.state = view.request.status;
    report.finalTasks = final.rows[0].count;
    report.negotiations = view.negotiations.length;
    report.success =
      metrics.noticeEnded === 1 &&
      Number(report.finishAt) > metrics.endedAt &&
      counts.finishRequests === 1 &&
      counts.finishStatus === 202 &&
      final.rows[0].count === 1 &&
      view.negotiations.length === 0;
    if (!report.success) throw new Error('AutomaticFinishInvariantFailed');
  } catch (error) {
    report.success = false;
    report.failure = error instanceof Error ? error.name : 'Unknown';
    report.counts = counts;
    report.playback = await page.evaluate(
      () => (window as unknown as { __noticeMetrics: unknown }).__noticeMetrics,
    );
    // Only fixed UI diagnostics and task metadata; no live transcript or provider text.
    report.alerts = await page.locator('.voice-page [role="alert"]').allTextContents();
    if (requestId)
      report.tasks = (await test.db.sync('u_hana')).tasks.filter((t) => t.requestId === requestId);
    throw error;
  }
} finally {
  await browser?.close();
  await vite.close();
  await worker.stop();
  await app.close();
  await test.cleanup();
  await writeFile(
    resolve(dir, `live-auto-finish-${String(report.startedAt).replaceAll(':', '-')}.json`),
    JSON.stringify(report, null, 2),
  );
  await writeFile(resolve(dir, 'live-auto-finish.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      success: report.success,
      report: 'test-artifacts/agent-refactor/live-auto-finish.json',
    }),
  );
}
