import { afterEach, expect, it, vi } from 'vitest';
import { CompletionPlayback } from './voice-completion.js';
const completion = { taskId: 'task_latest', inputRevision: 4, requestVersion: 1 };
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const audio = {
    ended: false,
    muted: false,
    volume: 1,
    onended: null as null | (() => void),
    onpause: null as null | (() => void),
    onerror: null as null | (() => void),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
  };
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return audio;
      }
    },
  );
  return audio;
}
it('only natural end of the finite notice permits one completion', async () => {
  const audio = setup();
  const monitor = new CompletionPlayback(completion);
  await monitor.start('wav');
  expect(monitor.take()).toBeNull();
  audio.onended?.();
  expect(monitor.take()).toBeNull();
  audio.ended = true;
  audio.onended?.();
  expect(monitor.take()).toEqual(completion);
  expect(monitor.take()).toBeNull();
  monitor.cancel();
  expect(audio.removeAttribute).toHaveBeenCalledWith('src');
});
it.each(['pause', 'error', 'cancel', 'muted', 'blocked'] as const)(
  'does not close after %s',
  async (failure) => {
    const audio = setup();
    const monitor = new CompletionPlayback(completion);
    if (failure === 'blocked') audio.play.mockRejectedValue(new Error('autoplay'));
    await monitor.start('wav').catch(() => {});
    if (failure === 'pause') audio.onpause?.();
    if (failure === 'error') audio.onerror?.();
    if (failure === 'cancel') monitor.cancel();
    if (failure === 'muted') audio.muted = true;
    audio.ended = true;
    audio.onended?.();
    expect(monitor.take()).toBeNull();
  },
);
