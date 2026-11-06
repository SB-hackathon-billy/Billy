// 통화 접수 화면용 WebRTC 클라이언트. 명세: docs/specs/0003-voice-call-reservation.md
// lib/voice.ts(VoiceClient)와 같은 /voice-sessions 계약·발화 순서 규칙을 쓰되, 서버가 수집 완료를
// 알려도 종료 안내·자동 종료를 하지 않고 화면의 최종 승인을 기다린다. 구 클라이언트는 /rental/classic에서만 쓴다.
import {
  VoiceSessionDataSchema,
  VoiceStateDataSchema,
  type VoiceStatus,
  type VoiceCompletion,
} from '@sb/contracts';
import { ActionScope, api, noContent, idPath } from '../../lib/api.js';

export interface CallSnapshot {
  inputRevision: number;
  voiceSessionId: string | null;
  /** Latest EXTRACT_NEED task the server attached to this call. */
  taskId: string | null;
  completion: VoiceCompletion | null;
  turnStatus: 'WAITING' | 'READY' | 'BLOCKED';
  userSpoke: boolean;
}
export interface CallEvents {
  status: (status: VoiceStatus) => void;
  transcript: (role: 'user' | 'assistant', delta: string) => void;
  error: (message: string) => void;
  snapshot: (snapshot: CallSnapshot) => void;
  processing?: (processing: boolean) => void;
}

const SPEECH_RMS = 0.025;
const SPEECH_SETTLE_MS = 900;
const POLL_MS = 1_200;

export class VoiceCallClient {
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private speechContext: AudioContext | null = null;
  private speechTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private generation = 0;
  private closeIntent = new ActionScope();
  private replyIntent = new ActionScope();
  private inputRevision = 0;
  private approvedRevision = 0;
  private repliedRevision = 0;
  private speechPending = false;
  private playbackAllowed = true;
  private lastSpeechAt = 0;
  private lastMutedOutputAt = 0;
  private userMuted = false;
  private held = false;
  private userSpoke = false;
  private lastFormTaskId: string | null = null;
  private formTaskBeforeSpeech: string | null = null;
  private awaitingForm = false;
  private pendingClose: Promise<void> | null = null;

  constructor(private readonly on: CallEvents) {}

  get voiceSessionId() {
    return this.sessionId;
  }

  async start(request: () => Promise<string>) {
    await this.stop();
    const generation = ++this.generation;
    this.on.status('CONNECTING');
    this.inputRevision = 0;
    this.approvedRevision = 0;
    this.repliedRevision = 0;
    this.speechPending = false;
    this.playbackAllowed = true;
    this.lastMutedOutputAt = 0;
    this.userMuted = false;
    this.held = false;
    this.userSpoke = false;
    this.lastFormTaskId = null;
    this.formTaskBeforeSpeech = null;
    this.awaitingForm = false;
    this.replyIntent = new ActionScope();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext)
        throw new Error('마이크를 사용하려면 localhost 접속과 지원 브라우저가 필요해요.');
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
      // Local speech detection closes playback before transcription arrives (same rule as VoiceClient).
      this.speechContext = new AudioContext();
      void this.speechContext.resume().catch(() => {});
      const analyser = this.speechContext.createAnalyser();
      analyser.fftSize = 512;
      this.speechContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      this.speechTimer = setInterval(() => {
        if (this.userMuted || this.held) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        if (rms > SPEECH_RMS) {
          this.beginProcessing();
          this.lastSpeechAt = Date.now();
          this.speechPending = true;
          this.closePlayback();
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
        if (!this.audio || generation !== this.generation) return;
        this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.audio
          .play()
          .catch(() => this.on.error('음성을 재생하려면 오디오 재생 버튼을 눌러 주세요.'));
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onmessage = (event) => this.onProviderEvent(generation, event.data);
      peer.onconnectionstatechange = () => {
        if (generation !== this.generation) return;
        if (peer.connectionState === 'connected') this.on.status('LISTENING');
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
      this.poll(generation);
      await peer.setRemoteDescription({ type: 'answer', sdp: response.sdpAnswer });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop();
      this.on.status('ERROR');
      this.on.error(describeStartError(error));
    }
  }

  private onProviderEvent(generation: number, raw: unknown) {
    if (generation !== this.generation) return;
    let value: Record<string, unknown>;
    try {
      const data: unknown = JSON.parse(String(raw));
      if (!data || typeof data !== 'object') return;
      value = data as Record<string, unknown>;
    } catch {
      return; // Non-JSON provider messages cannot mutate application state.
    }
    if (value.type === 'session.input_transcript.delta' && typeof value.delta === 'string') {
      this.inputRevision++;
      this.userSpoke = true;
      this.speechPending = true;
      this.closePlayback();
      this.on.status('LISTENING');
      this.on.transcript('user', value.delta);
      this.beginProcessing();
    }
    if (value.type === 'session.output_transcript.delta' && typeof value.delta === 'string') {
      if (this.playbackAllowed && !this.held) {
        this.on.status('SPEAKING');
        this.on.transcript('assistant', value.delta);
      } else this.lastMutedOutputAt = Date.now();
    }
    if (value.type === 'session.started') this.on.status('LISTENING');
    if (value.type === 'session.closed') void this.stop();
    if (value.type === 'error') {
      this.on.error('음성 연결에 오류가 생겼어요. 다시 연결하거나 신청서를 직접 확인해 주세요.');
      void this.disconnected();
    }
  }

  private closePlayback() {
    this.playbackAllowed = false;
    if (this.audio) this.audio.muted = true;
  }

  private beginProcessing() {
    if (!this.awaitingForm) this.formTaskBeforeSpeech = this.lastFormTaskId;
    this.awaitingForm = true;
    this.on.processing?.(true);
  }

  private poll(generation: number) {
    const id = this.sessionId;
    if (!id || generation !== this.generation) return;
    void api
      .get(`/voice-sessions/${idPath(id)}`, VoiceStateDataSchema)
      .then((value) => {
        if (generation !== this.generation) return;
        if (!value.active) {
          void this.disconnected();
          return;
        }
        // Same readiness rule as VoiceClient: the server's revision has caught up, local speech has
        // settled, and nothing generated while muted is still being flushed.
        const ready =
          value.inputRevision >= this.inputRevision &&
          (!this.speechPending || value.inputRevision > this.approvedRevision) &&
          (value.inputRevision <= this.repliedRevision ||
            Date.now() - this.lastMutedOutputAt > 1000) &&
          value.turnStatus !== 'WAITING' &&
          Date.now() - this.lastSpeechAt > SPEECH_SETTLE_MS;
        if (ready) {
          this.speechPending = false;
          this.approvedRevision = value.inputRevision;
        }
        // READY permits a spoken reply before extraction finishes. The server keeps the previous
        // formTaskId until a new extraction succeeds, so never treat READY alone as a new form.
        this.lastFormTaskId = value.taskId;
        if (
          ready &&
          (value.turnStatus === 'BLOCKED' ||
            (value.taskId !== null && value.taskId !== this.formTaskBeforeSpeech))
        ) {
          this.awaitingForm = false;
          this.on.processing?.(false);
        }
        this.playbackAllowed = ready && !this.held;
        if (this.audio) this.audio.muted = !this.playbackAllowed;
        this.on.snapshot({
          inputRevision: value.inputRevision,
          voiceSessionId: id,
          taskId: value.taskId,
          completion: value.completion,
          turnStatus: value.turnStatus,
          userSpoke: this.userSpoke,
        });
        // Completion never triggers the farewell clip here: the agent answers normally and the
        // screen asks for approval. Only a plain reply for the latest finished utterance is requested.
        if (ready && !this.held && value.inputRevision > this.repliedRevision) {
          this.repliedRevision = value.inputRevision;
          void api
            .execute(
              this.replyIntent.command(`/voice-sessions/${idPath(id)}/respond`, 'POST', {
                inputRevision: value.inputRevision,
              }),
              noContent,
            )
            .catch(() => {
              if (generation === this.generation)
                this.on.error('답변을 이어가지 못했어요. 다시 말씀해 주세요.');
            });
        }
        if (value.turnStatus === 'BLOCKED')
          this.on.error('물품 대여 신청에 필요한 정보만 도와드릴 수 있어요.');
      })
      .catch(() => this.closePlayback())
      .finally(() => {
        if (generation === this.generation)
          this.pollTimer = setTimeout(() => this.poll(generation), POLL_MS);
      });
  }

  mute(muted: boolean) {
    this.userMuted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted && !this.held;
    });
  }

  /** Approval in progress: stop capturing and silence the agent while the tool runs. */
  hold() {
    this.held = true;
    this.closePlayback();
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  play() {
    void this.audio
      ?.play()
      .catch(() => this.on.error('브라우저의 오디오 재생 허용을 확인해 주세요.'));
  }

  private async disconnected() {
    await this.stop();
    this.on.status('RECONNECT_REQUIRED');
  }

  stop(): Promise<void> {
    this.generation++;
    this.awaitingForm = false;
    this.on.processing?.(false);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.speechTimer) clearInterval(this.speechTimer);
    this.pollTimer = null;
    this.speechTimer = null;
    void this.speechContext?.close().catch(() => {});
    this.speechContext = null;
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
    this.on.status('CLOSED');
    const id = this.sessionId;
    this.sessionId = null;
    if (id)
      this.pendingClose = api
        .execute(this.closeIntent.command(`/voice-sessions/${idPath(id)}`, 'DELETE'), noContent)
        .catch(() => {
          this.on.error('마이크는 꺼졌어요. 서버 종료 확인은 연결 복구 후 이루어집니다.');
        })
        .finally(() => {
          this.pendingClose = null;
        });
    return this.pendingClose ?? Promise.resolve();
  }
}

export function describeStartError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return '마이크 권한이 꺼져 있어요. 브라우저 설정에서 허용하거나 신청서를 직접 작성해 주세요.';
  if (error instanceof DOMException && error.name === 'NotFoundError')
    return '사용할 수 있는 마이크가 없어요. 마이크를 연결하거나 신청서를 직접 작성해 주세요.';
  if (error instanceof DOMException && error.name === 'NotReadableError')
    return '마이크를 사용할 수 없어요. 다른 앱에서 사용 중인지 확인해 주세요.';
  return error instanceof Error ? error.message : '음성 연결을 시작하지 못했어요.';
}
