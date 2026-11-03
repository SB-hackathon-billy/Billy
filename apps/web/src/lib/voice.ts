import {
  VoiceSessionDataSchema,
  VoiceCompletionAudioDataSchema,
  VOICE_COMPLETION_NOTICE,
  VoiceStateDataSchema,
  TaskAcceptedDataSchema,
  type VoiceStatus,
  type VoiceCompletion,
  type TaskAcceptedData,
} from '@sb/contracts';
import { CompletionPlayback } from './voice-completion.js';
import { ActionScope, ApiError, api, noContent, idPath } from './api.js';

export interface TranscriptLine {
  role: 'user' | 'assistant';
  text: string;
}
export class VoiceClient {
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private sessionId: string | null = null;
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private pendingClose: Promise<void> | null = null;
  private closeIntent = new ActionScope();
  private finishIntent = new ActionScope();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private inputRevision = 0;
  private finishing = false;
  private playbackAllowed = true;
  private speechPending = false;
  private approvedRevision = 0;
  private speechContext: AudioContext | null = null;
  private speechTimer: ReturnType<typeof setInterval> | null = null;
  private lastSpeechAt = 0;
  private lastMutedOutputAt = 0;
  private userMuted = false;
  private repliedRevision = 0;
  private replyIntent = new ActionScope();
  private completionPlayback: CompletionPlayback | null = null;
  private completionAttempt: string | null = null;
  private finishInFlight: Promise<TaskAcceptedData> | null = null;
  constructor(
    private state: (status: VoiceStatus) => void,
    private transcript: (role: 'user' | 'assistant', delta: string) => void,
    private error: (message: string) => void,
    private formTask: (taskId: string | null) => void = () => {},
    private autoFinish: (completion: VoiceCompletion) => void = () => {},
  ) {}
  async start(request: () => Promise<string>) {
    await this.stop();
    const generation = ++this.generation;
    this.state('CONNECTING');
    this.inputRevision = 0;
    this.completionAttempt = null;
    this.completionPlayback = null;
    this.repliedRevision = 0;
    this.userMuted = false;
    this.replyIntent = new ActionScope();
    this.playbackAllowed = true;
    this.speechPending = false;
    this.approvedRevision = 0;
    this.lastMutedOutputAt = 0;
    this.finishing = false;
    this.finishIntent = new ActionScope();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext)
        throw new Error('마이크를 사용하려면 localhost 접속과 지원 브라우저가 필요해요.');
      // Some engines return a generic capture error even for a known denied permission.
      // Respect the browser permission state first, with getUserMedia as the Safari fallback.
      const permission = await navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .catch(() => null);
      if (permission?.state === 'denied')
        throw new DOMException('Microphone permission denied', 'NotAllowedError');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      // Local speech detection closes playback before transcription arrives. Decisions
      // must subsequently approve a completed turn; silence alone never opens it.
      this.speechContext = new AudioContext();
      void this.speechContext.resume().catch(() => {});
      const analyser = this.speechContext.createAnalyser();
      analyser.fftSize = 512;
      this.speechContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.speechTimer = setInterval(() => {
        if (this.userMuted || this.finishing) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
        if (rms > 0.025) {
          this.cancelCompletion();
          this.lastSpeechAt = Date.now();
          this.speechPending = true;
          this.playbackAllowed = false;
          if (this.audio) this.audio.muted = true;
        }
      }, 50);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      const requestId = await request();
      if (generation !== this.generation) return;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.audio = new Audio();
      this.audio.autoplay = true;
      this.audio.setAttribute('playsinline', '');
      peer.ontrack = (event) => {
        if (this.audio && generation === this.generation) {
          const remote = event.streams[0] ?? new MediaStream([event.track]);
          this.audio.srcObject = remote;
          void this.audio
            .play()
            .catch(() => this.error('음성을 재생하려면 오디오 재생 버튼을 눌러 주세요.'));
        }
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onmessage = (event) => {
        if (generation !== this.generation) return;
        try {
          const data: unknown = JSON.parse(String(event.data));
          if (!data || typeof data !== 'object') return;
          const value = data as Record<string, unknown>;
          if (value.type === 'session.input_transcript.delta' && typeof value.delta === 'string') {
            this.cancelCompletion();
            this.inputRevision++;
            this.speechPending = true;
            this.playbackAllowed = false;
            if (this.audio) this.audio.muted = true;
            this.state('LISTENING');
            this.transcript('user', value.delta);
          }
          if (value.type === 'session.output_transcript.delta' && typeof value.delta === 'string') {
            if (this.playbackAllowed && !this.finishing) {
              this.state('SPEAKING');
              this.transcript('assistant', value.delta);
            } else this.lastMutedOutputAt = Date.now();
          }
          if (value.type === 'session.started') this.state('LISTENING');
          if (value.type === 'session.closed' && !this.finishing) {
            void this.stop();
          }
          if (value.type === 'error') {
            this.error('음성 연결에 오류가 생겼어요. 새 연결이나 텍스트 입력을 이용해 주세요.');
            void this.disconnected();
          }
        } catch {
          /* Non-JSON provider messages cannot mutate application state. */
        }
      };
      peer.onconnectionstatechange = () => {
        if (generation !== this.generation) return;
        if (peer.connectionState === 'connected') this.state('LISTENING');
        if (['failed', 'disconnected'].includes(peer.connectionState)) void this.disconnected();
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await api.execute(
        new ActionScope().command('/voice-sessions', 'POST', { requestId, sdpOffer: offer.sdp }),
        VoiceSessionDataSchema,
      );
      if (generation !== this.generation) {
        await api.execute(
          new ActionScope().command(`/voice-sessions/${idPath(response.voiceSessionId)}`, 'DELETE'),
          noContent,
        );
        return;
      }
      this.sessionId = response.voiceSessionId;
      this.closeIntent = new ActionScope();
      this.pollState(generation);
      await peer.setRemoteDescription({ type: 'answer', sdp: response.sdpAnswer });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop();
      this.state('ERROR');
      this.error(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '마이크 권한이 꺼져 있어요. 브라우저 설정에서 허용하거나 텍스트로 이어가세요.'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? '사용할 수 있는 마이크가 없어요. 마이크를 연결하거나 텍스트로 이어가세요.'
            : error instanceof DOMException && error.name === 'NotReadableError'
              ? '마이크를 사용할 수 없어요. 다른 앱에서 사용 중인지 확인하거나 텍스트로 이어가세요.'
              : error instanceof Error
                ? error.message
                : '음성 연결을 시작하지 못했어요.',
      );
    }
  }
  mute(muted: boolean) {
    this.userMuted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }
  private pollState(generation: number) {
    const id = this.sessionId;
    if (!id || generation !== this.generation || this.finishing) return;
    void api
      .get(`/voice-sessions/${idPath(id)}`, VoiceStateDataSchema)
      .then((value) => {
        if (generation !== this.generation || this.finishing) return;
        if (!value.active) {
          void this.disconnected();
          return;
        }
        this.formTask(value.taskId);
        const ready =
          value.inputRevision >= this.inputRevision &&
          (!this.speechPending || value.inputRevision > this.approvedRevision) &&
          (value.inputRevision <= this.repliedRevision ||
            Date.now() - this.lastMutedOutputAt > 1000) &&
          value.turnStatus !== 'WAITING' &&
          Date.now() - this.lastSpeechAt > 900;
        if (ready) {
          this.speechPending = false;
          this.approvedRevision = value.inputRevision;
        }
        const preparingCompletion =
          !!value.completion &&
          (this.completionAttempt !== value.completion.taskId || !!this.completionPlayback);
        this.playbackAllowed = ready && !preparingCompletion;
        if (this.audio) this.audio.muted = !this.playbackAllowed;
        if (!value.completion || value.completion.inputRevision !== this.approvedRevision)
          this.cancelCompletion();
        if (
          ready &&
          value.completion &&
          value.completion.inputRevision === this.approvedRevision &&
          (this.completionAttempt !== value.completion.taskId || this.completionPlayback)
        ) {
          const completion = value.completion;
          // Live generates the farewell silently; only the finite verified clip is played.
          this.playbackAllowed = false;
          if (this.audio) this.audio.muted = true;
          if (this.completionAttempt !== completion.taskId) {
            this.completionAttempt = completion.taskId;
            this.repliedRevision = value.inputRevision;
            const playback = new CompletionPlayback(completion);
            this.completionPlayback = playback;
            playback.loading = true;
            void api
              .execute(
                new ActionScope().command(`/voice-sessions/${idPath(id)}/respond`, 'POST', {
                  inputRevision: completion.inputRevision,
                  completionTaskId: completion.taskId,
                }),
                noContent,
              )
              .then(() => {
                playback.loading = false;
              })
              .catch(() => {
                if (generation !== this.generation || this.completionPlayback !== playback) return;
                this.cancelCompletion();
                this.error(
                  '종료 안내를 확인하지 못했어요. 통화 종료·조회 버튼으로 마무리해 주세요.',
                );
              });
          }
          const playback = this.completionPlayback;
          if (playback?.failed) {
            this.cancelCompletion();
            this.error('종료 안내 재생이 중단됐어요. 통화 종료·조회 버튼으로 마무리해 주세요.');
          }
          if (playback && !playback.failed && !playback.loading && !playback.started) {
            if (Date.now() - playback.createdAt > 30_000) {
              this.cancelCompletion();
              this.error(
                '종료 안내 음성을 준비하지 못했어요. 통화 종료·조회 버튼으로 마무리해 주세요.',
              );
            } else {
              playback.loading = true;
              void api
                .get(
                  `/voice-sessions/${idPath(id)}/completion-audio?taskId=${idPath(completion.taskId)}&inputRevision=${completion.inputRevision}`,
                  VoiceCompletionAudioDataSchema,
                )
                .then(async (result) => {
                  if (
                    generation !== this.generation ||
                    this.completionPlayback !== playback ||
                    this.speechPending
                  )
                    return;
                  if (
                    result.completion.taskId !== completion.taskId ||
                    result.completion.inputRevision !== completion.inputRevision
                  )
                    return;
                  if (result.audioWav) {
                    await playback.start(result.audioWav);
                    if (this.completionPlayback === playback) {
                      this.state('SPEAKING');
                      this.transcript('assistant', VOICE_COMPLETION_NOTICE);
                    }
                  }
                })
                .catch(() => {
                  if (generation !== this.generation || this.completionPlayback !== playback)
                    return;
                  this.cancelCompletion();
                  this.error(
                    '종료 안내를 재생하지 못했어요. 통화 종료·조회 버튼으로 마무리해 주세요.',
                  );
                })
                .finally(() => {
                  playback.loading = false;
                });
            }
          }
          const completed = this.completionPlayback?.take();
          if (completed) this.autoFinish(completed);
        } else if (ready && value.inputRevision > this.repliedRevision) {
          this.repliedRevision = value.inputRevision;
          // Playback is open before asking Live to speak: do not clip the start of its answer.
          void api
            .execute(
              this.replyIntent.command(`/voice-sessions/${idPath(id)}/respond`, 'POST', {
                inputRevision: value.inputRevision,
              }),
              noContent,
            )
            .catch(() => {
              if (generation === this.generation)
                this.error(
                  '답변을 이어가지 못했어요. 다시 말씀하거나 통화 종료·조회를 눌러 주세요.',
                );
            });
        }
        if (value.turnStatus === 'BLOCKED')
          this.error(
            '대여 신청에 필요한 정보만 도와드릴 수 있어요. 물품과 사용 계획을 알려 주세요.',
          );
      })
      .catch(() => {
        this.playbackAllowed = false;
        if (this.audio) this.audio.muted = true;
      })
      .finally(() => {
        if (generation === this.generation && !this.finishing)
          this.pollTimer = setTimeout(() => this.pollState(generation), 1200);
      });
  }
  finish(expectedRequestVersion: number, completion?: VoiceCompletion): Promise<TaskAcceptedData> {
    if (this.finishInFlight) return this.finishInFlight;
    this.finishInFlight = this.finishOnce(expectedRequestVersion, completion).finally(() => {
      this.finishInFlight = null;
    });
    return this.finishInFlight;
  }
  private async finishOnce(expectedRequestVersion: number, completion?: VoiceCompletion) {
    const id = this.sessionId;
    if (!id) throw new Error('통화가 종료됐어요. 신청서를 확인해 직접 조회해 주세요.');
    if (
      completion &&
      (this.speechPending ||
        completion.inputRevision !== this.approvedRevision ||
        completion.inputRevision < this.inputRevision)
    )
      throw new Error('새 발화를 확인하고 있어요.');
    const previousMuted = this.userMuted;
    if (completion) {
      const generation = this.generation;
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (
        generation !== this.generation ||
        this.speechPending ||
        completion.inputRevision < this.inputRevision ||
        !this.completionPlayback
      )
        throw new Error('새 발화를 확인하고 있어요.');
    }
    this.finishing = true;
    this.mute(true);
    if (this.audio) this.audio.muted = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    // Keep silent RTP flowing briefly so the final captured speech reaches sideband.
    if (!completion) await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      const accepted = await api.execute(
        this.finishIntent.command(`/voice-sessions/${idPath(id)}/finish`, 'POST', {
          expectedRequestVersion,
          ...(completion ? { completion } : {}),
        }),
        TaskAcceptedDataSchema,
      );
      this.sessionId = null;
      await this.stop();
      return accepted;
    } catch (error) {
      if (
        completion &&
        error instanceof ApiError &&
        ['INVALID_STATE', 'VERSION_CONFLICT'].includes(error.code)
      ) {
        this.cancelCompletion();
        this.finishIntent = new ActionScope();
        // A version can change after the server's precheck and provider close.
        // Restore the microphone only when the server confirms the call survived.
        const current = await api
          .get(`/voice-sessions/${idPath(id)}`, VoiceStateDataSchema)
          .catch(() => null);
        if (current?.active && this.sessionId === id) {
          this.finishing = false;
          this.mute(previousMuted);
          this.pollState(this.generation);
        } else {
          await this.stop();
        }
        throw error;
      }
      this.stream?.getTracks().forEach((track) => track.stop());
      this.state('CLOSED');
      // Retain the ID and ActionScope for an idempotent retry after a lost response.
      if (!(error instanceof ApiError && error.code === 'NETWORK'))
        this.finishIntent = new ActionScope();
      this.peer?.close();
      if (this.speechTimer) clearInterval(this.speechTimer);
      this.speechTimer = null;
      void this.speechContext?.close().catch(() => {});
      this.speechContext = null;
      throw error;
    }
  }
  private cancelCompletion() {
    this.completionPlayback?.cancel();
    this.completionPlayback = null;
  }
  play() {
    void this.audio?.play().catch(() => this.error('브라우저의 오디오 재생 허용을 확인해 주세요.'));
  }
  private async disconnected() {
    if (this.finishing) return;
    await this.stop();
    this.state('RECONNECT_REQUIRED');
  }
  stop(): Promise<void> {
    this.generation++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.speechTimer) clearInterval(this.speechTimer);
    this.pollTimer = null;
    this.speechTimer = null;
    void this.speechContext?.close().catch(() => {});
    this.speechContext = null;
    this.cancelCompletion();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
    this.state('CLOSED');
    const id = this.sessionId;
    this.sessionId = null;
    if (id)
      this.pendingClose = api
        .execute(this.closeIntent.command(`/voice-sessions/${idPath(id)}`, 'DELETE'), noContent)
        .catch(() => {
          this.error('마이크는 꺼졌어요. 서버 종료 확인은 연결 복구 후 이루어집니다.');
        })
        .finally(() => {
          this.pendingClose = null;
        });
    return this.pendingClose ?? Promise.resolve();
  }
}
