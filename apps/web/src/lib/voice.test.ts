import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.js';
import { VoiceClient } from './voice.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const track = { enabled: true, stop: vi.fn() };
  const channel = { onmessage: null as ((event: { data: string }) => void) | null, close: vi.fn() };
  const audio = {
    ended: false,
    volume: 1,
    onended: null as null | (() => void),
    onpause: null as null | (() => void),
    onerror: null as null | (() => void),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    muted: false,
    autoplay: false,
    srcObject: null,
    setAttribute: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
  };
  const notice = { ...audio };
  let audioCount = 0;
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
    },
  });
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return audioCount++ === 0 ? audio : notice;
      }
    },
  );
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = async () => {};
      close = async () => {};
      createMediaStreamSource = () => ({ connect() {} });
      createAnalyser = () => ({
        fftSize: 512,
        getFloatTimeDomainData(data: Float32Array) {
          data.fill(0);
        },
      });
    },
  );
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      addTrack() {}
      close() {}
      createDataChannel = () => channel;
      createOffer = async () => ({ type: 'offer', sdp: 'offer' });
      setLocalDescription = async () => {};
      setRemoteDescription = async () => {};
    },
  );
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ inputRevision: 0, turnStatus: 'READY', taskId: null, active: true });
  const execute = vi
    .spyOn(api, 'execute')
    .mockImplementation(
      async (intent) =>
        (intent.path === '/voice-sessions'
          ? { voiceSessionId: 'voice_test', sdpAnswer: 'answer' }
          : undefined) as never,
    );
  const autoFinish = vi.fn();
  const client = new VoiceClient(vi.fn(), vi.fn(), vi.fn(), vi.fn(), autoFinish);
  const emit = (type: string, delta = '') =>
    channel.onmessage?.({ data: JSON.stringify({ type, delta }) });
  return { client, track, audio, notice, autoFinish, execute, get, emit };
}

it('keeps playback muted until the current input has a completed Decisions result, then requests a fresh answer', async () => {
  const { client, audio, get, execute, emit } = setup();
  await client.start(async () => 'req_test');
  emit('session.input_transcript.delta', '드라이버가 필요한데');
  await vi.advanceTimersByTimeAsync(1300);
  expect(audio.muted).toBe(true); // an older READY snapshot is insufficient
  get.mockResolvedValue({ inputRevision: 1, turnStatus: 'WAITING', taskId: null, active: true });
  await vi.advanceTimersByTimeAsync(1300);
  expect(audio.muted).toBe(true);
  get.mockResolvedValue({ inputRevision: 1, turnStatus: 'READY', taskId: null, active: true });
  emit('session.output_transcript.delta', '숨겨진 중간 답변');
  await vi.advanceTimersByTimeAsync(2600);
  expect(audio.muted).toBe(false);
  expect(execute.mock.calls.filter(([intent]) => intent.path.endsWith('/respond'))).toHaveLength(1);
  await client.stop();
});

it('retains finish identity after provider close and a lost HTTP response, and retries the same command', async () => {
  const { client, track, execute, emit } = setup();
  await client.start(async () => 'req_test');
  const keys: string[] = [];
  execute.mockImplementation(async (intent) => {
    if (intent.path.endsWith('/finish')) {
      keys.push(intent.key);
      emit('session.closed');
      if (keys.length === 1) throw new ApiError('NETWORK', 'lost response');
      return { taskId: 'task_finished' } as never;
    }
    return undefined as never;
  });
  const first = client.finish(1);
  const rejected = expect(first).rejects.toMatchObject({ code: 'NETWORK' });
  expect(track.enabled).toBe(false);
  await vi.advanceTimersByTimeAsync(900);
  await rejected;
  expect(track.stop).toHaveBeenCalled();
  const retry = client.finish(1);
  await vi.advanceTimersByTimeAsync(900);
  expect(await retry).toEqual({ taskId: 'task_finished' });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

it('plays a finite farewell before requesting automatic finish once, with no new input', async () => {
  const { client, audio, notice, autoFinish, get, execute, emit } = setup();
  await client.start(async () => 'req_test');
  const completion = { taskId: 'task_complete', inputRevision: 1, requestVersion: 1 };
  get.mockImplementation(
    async (path) =>
      (path.includes('/completion-audio')
        ? { completion, audioWav: 'wav' }
        : {
            inputRevision: 1,
            turnStatus: 'READY',
            taskId: completion.taskId,
            active: true,
            completion,
          }) as never,
  );
  emit('session.input_transcript.delta', '필수 정보 모두');
  await vi.advanceTimersByTimeAsync(2600);
  expect(audio.muted).toBe(true);
  expect(notice.play).toHaveBeenCalled();
  expect(autoFinish).not.toHaveBeenCalled();
  notice.ended = true;
  notice.onended?.();
  await vi.advanceTimersByTimeAsync(1300);
  expect(autoFinish).toHaveBeenCalledExactlyOnceWith(completion);
  await vi.advanceTimersByTimeAsync(1300);
  expect(autoFinish).toHaveBeenCalledTimes(1);
  const first = client.finish(1, completion);
  const second = client.finish(1);
  expect(first).toBe(second);
  await vi.advanceTimersByTimeAsync(300);
  await first;
  expect(execute.mock.calls.filter(([intent]) => intent.path.endsWith('/finish'))).toHaveLength(1);
});

it('cancels a pending farewell on new speech and ignores its late ended callback', async () => {
  const { client, notice, autoFinish, get, emit } = setup();
  await client.start(async () => 'req_test');
  const completion = { taskId: 'task_complete', inputRevision: 1, requestVersion: 1 };
  get.mockImplementation(
    async (path) =>
      (path.includes('/completion-audio')
        ? { completion, audioWav: 'wav' }
        : {
            inputRevision: 1,
            turnStatus: 'READY',
            taskId: completion.taskId,
            active: true,
            completion,
          }) as never,
  );
  emit('session.input_transcript.delta', '전체 조건');
  await vi.advanceTimersByTimeAsync(2600);
  const ended = notice.onended;
  emit('session.input_transcript.delta', '잠깐만요');
  notice.ended = true;
  ended?.();
  await vi.advanceTimersByTimeAsync(2500);
  expect(autoFinish).not.toHaveBeenCalled();
  expect(notice.removeAttribute).toHaveBeenCalledWith('src');
  await client.stop();
});

it.each([true, false])(
  'restores the microphone after a conflict only if the server is active=%s',
  async (active) => {
    const { client, track, notice, get, execute, emit } = setup();
    await client.start(async () => 'req_test');
    const completion = { taskId: 'task_complete', inputRevision: 1, requestVersion: 1 };
    let rejected = false;
    get.mockImplementation(
      async (path) =>
        (path.includes('/completion-audio')
          ? { completion, audioWav: 'wav' }
          : {
              inputRevision: 1,
              turnStatus: 'READY',
              taskId: completion.taskId,
              active: rejected ? active : true,
              completion,
            }) as never,
    );
    emit('session.input_transcript.delta', '전체 조건');
    await vi.advanceTimersByTimeAsync(2600);
    notice.ended = true;
    notice.onended?.();
    await vi.advanceTimersByTimeAsync(1300);
    execute.mockImplementation(async (intent) => {
      if (intent.path.endsWith('/finish')) {
        rejected = true;
        throw new ApiError('VERSION_CONFLICT', 'conflict');
      }
      return undefined as never;
    });
    const finishing = client.finish(1, completion);
    const failure = expect(finishing).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await vi.advanceTimersByTimeAsync(300);
    await failure;
    expect(track.enabled).toBe(active);
    if (!active) expect(track.stop).toHaveBeenCalled();
    await client.stop();
  },
);
