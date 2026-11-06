import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceCallClient } from './call-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('voice extraction processing', () => {
  it('keeps writing through READY with the old form until the corrected form arrives', async () => {
    vi.useFakeTimers();
    const processing = vi.fn();
    const snapshot = vi.fn();
    const client = new VoiceCallClient({
      status: vi.fn(),
      transcript: vi.fn(),
      error: vi.fn(),
      snapshot,
      processing,
    });
    // Exercise provider events and polling without acquiring a microphone.
    client['sessionId'] = 'voice_test';
    client['lastFormTaskId'] = 'task_old';
    client['onProviderEvent'](
      0,
      JSON.stringify({
        type: 'session.input_transcript.delta',
        delta: '아니요, 청소기요',
      }),
    );
    expect(processing).toHaveBeenLastCalledWith(true);

    let taskId = 'task_old';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST' || init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : new Response(
              JSON.stringify({
                data: {
                  active: true,
                  inputRevision: 1,
                  turnStatus: 'READY',
                  taskId,
                  completion: null,
                },
                meta: {
                  contractVersion: '0.3.0',
                  serverTime: new Date().toISOString(),
                  traceId: 'trace_test',
                },
              }),
              { status: 200 },
            ),
      ),
    );
    client['poll'](0);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalled();
    expect(processing).toHaveBeenLastCalledWith(true);
    taskId = 'task_new';
    await vi.advanceTimersByTimeAsync(1200);
    expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'task_new' }));
    expect(processing).toHaveBeenLastCalledWith(false);
    await client.stop();
  });

  it('clears pending writing when the call stops', async () => {
    const processing = vi.fn();
    const client = new VoiceCallClient({
      status: vi.fn(),
      transcript: vi.fn(),
      error: vi.fn(),
      snapshot: vi.fn(),
      processing,
    });
    client['onProviderEvent'](
      0,
      JSON.stringify({ type: 'session.input_transcript.delta', delta: '캐리어' }),
    );
    expect(processing).toHaveBeenLastCalledWith(true);
    await client.stop();
    expect(processing).toHaveBeenLastCalledWith(false);
  });
});
