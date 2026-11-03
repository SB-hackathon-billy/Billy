import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import WebSocket from 'ws';
import { z } from 'zod';
import type {
  VoiceGateway as VoiceGatewayPort,
  VoiceGatewayEvent,
  VoiceGatewaySession,
  VoiceAppendInput,
  VoiceStatus,
} from '@sb/contracts';
import { AUTHORITY_RULES, VOICE_RULES } from './agents/instructions.js';
import { VOICE_AGENT, VOICE_LIMITS } from './agents/definitions.js';
export { VOICE_LIMITS } from './agents/definitions.js';
import {
  AiAdapterError,
  createOpenAIClient,
  positiveMs,
  readAiConfig,
  type AiEnvironment,
} from './runtime.js';

const allowedTools = new Set<string>(VOICE_AGENT.backendCapabilities.map((tool) => tool.name));
export const VOICE_GREETING = VOICE_RULES.greeting;
export interface VoiceTool {
  name: string;
  description: string;
}
export interface CreateVoiceSessionInput {
  requestId: string;
  actorUserId: string;
  sdpOffer: string;
  onEvent: (event: VoiceGatewayEvent) => void | Promise<void>;
  instructions?: string;
  /** Client delegation has no wire tools field; these names describe server capabilities. */
  tools?: readonly VoiceTool[];
  /** Useful for server WebRTC peers: apply SDP before awaiting session.started. */
  onTransportReady?: (answer: { externalSessionId: string; sdpAnswer: string }) => Promise<void>;
}
export interface ManagedVoiceSession extends VoiceGatewaySession {
  externalSessionId: string;
  appendCommentary(input: { delegationId: string | null; content: string }): Promise<void>;
  appendThinking(input: { delegationId: string | null; content: string }): Promise<void>;
  /** Call from trusted playback/activity telemetry, never from model business claims. */
  markActivity(): void;
  setPlaybackActive(active: boolean): void;
}
export interface VoiceGatewayOptions {
  client?: OpenAI;
  socketFactory?: (url: string, options: WebSocket.ClientOptions) => WebSocket;
  timing?: Partial<Record<keyof typeof VOICE_LIMITS, number>>;
}
const createdSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  transport: z.object({ type: z.literal('webrtc'), sdp: z.string().min(1) }),
});
const eventSchema = z.object({ type: z.string() }).passthrough();

export function voiceStatusForEvent(
  event: VoiceGatewayEvent | { type: 'connecting' | 'idle' | 'output.finished' },
): VoiceStatus {
  switch (event.type) {
    case 'idle':
      return 'IDLE';
    case 'connecting':
      return 'CONNECTING';
    case 'session.output_transcript.delta':
      return 'SPEAKING';
    case 'session.closed':
      return 'CLOSED';
    case 'disconnected':
      return 'RECONNECT_REQUIRED';
    case 'error':
      return 'ERROR';
    default:
      return 'LISTENING';
  }
}

/** No DB or domain-command capability is provided to this gateway. */
export class OpenAiVoiceGateway implements VoiceGatewayPort {
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly socketFactory: NonNullable<VoiceGatewayOptions['socketFactory']>;
  private readonly timing: Record<keyof typeof VOICE_LIMITS, number>;
  constructor(env: AiEnvironment = process.env, options: VoiceGatewayOptions = {}) {
    const config = readAiConfig(env);
    if (config.mode !== 'live' || !config.apiKey)
      throw new AiAdapterError(
        'LIVE_VOICE_REQUIRED',
        'VoiceGateway requires AI_MODE=live and a server API key; text fixtures do not simulate WebRTC.',
      );
    this.client = options.client ?? createOpenAIClient(config);
    this.apiKey = config.apiKey;
    this.model = config[VOICE_AGENT.modelKey];
    this.socketFactory = options.socketFactory ?? ((url, opts) => new WebSocket(url, opts));
    this.timing = { ...VOICE_LIMITS, ...options.timing };
    for (const key of Object.keys(VOICE_LIMITS) as (keyof typeof VOICE_LIMITS)[]) {
      positiveMs(this.timing[key], key);
      if (this.timing[key] > VOICE_LIMITS[key])
        throw new AiAdapterError('INVALID_CONFIG', `${key} exceeds policy limit`);
    }
  }

  private socket(sessionId: string): WebSocket {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (this.client.organization) headers['OpenAI-Organization'] = this.client.organization;
    if (this.client.project) headers['OpenAI-Project'] = this.client.project;
    return this.socketFactory(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`,
      { headers, handshakeTimeout: this.timing.startupMs, maxPayload: 1_048_576 },
    );
  }

  /** Reattach only to send close if the control connection failed. No HTTP delete API is assumed. */
  private emergencyClose(sessionId: string): Promise<{ confirmed: boolean }> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = this.socket(sessionId);
      } catch {
        resolve({ confirmed: false });
        return;
      }
      const finish = (confirmed: boolean) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.terminate();
        resolve({ confirmed });
      };
      const timer = setTimeout(() => finish(false), this.timing.closeMs);
      socket.once('open', () =>
        socket.send(JSON.stringify({ type: 'session.close', event_id: randomUUID() }), (error) => {
          if (error) finish(false);
        }),
      );
      socket.on('message', (data) => {
        try {
          if ((JSON.parse(data.toString()) as { type?: string }).type === 'session.closed')
            finish(true);
        } catch {
          /* Ignore unrelated malformed data during cleanup. */
        }
      });
      socket.once('error', () => finish(false));
      socket.once('close', () => finish(false));
    });
  }

  async createSession(input: CreateVoiceSessionInput): Promise<ManagedVoiceSession> {
    if (
      !/^req_[A-Za-z0-9_-]+$/.test(input.requestId) ||
      !input.actorUserId ||
      !input.sdpOffer.trim()
    )
      throw new AiAdapterError('INVALID_VOICE_INPUT');
    if (input.tools?.some((tool) => !allowedTools.has(tool.name)))
      throw new AiAdapterError('FORBIDDEN_VOICE_TOOL');
    const instructions = `${AUTHORITY_RULES}\n${VOICE_AGENT.instructions}\n${input.instructions ?? ''}\n서버에서만 처리하는 기능: ${JSON.stringify(input.tools ?? [])}`;
    // Creation is not retried: a lost response could otherwise leave a second billable session.
    const created = createdSchema.parse(
      await this.client.live.create(
        {
          session: {
            model: this.model,
            instructions,
            input: [{ role: 'developer', content: [{ type: 'input_text', text: VOICE_GREETING }] }],
            delegation: { type: 'client' },
            store: false,
            client: {
              data_channel: {
                allowed_client_events: [
                  'session.close',
                  'session.input_audio.mute',
                  'session.input_audio.unmute',
                ],
                allowed_server_events: [
                  { type: 'session.started' },
                  { type: 'session.input_transcript.delta' },
                  { type: 'session.output_transcript.delta' },
                  { type: 'session.closed' },
                  { type: 'error' },
                ],
              },
            },
          },
          transport: { type: 'webrtc', sdp: input.sdpOffer },
        },
        { maxRetries: 0 },
      ),
    );
    const sessionId = created.session.id;
    let session: LiveSession | undefined;
    try {
      session = new LiveSession(
        sessionId,
        created.transport.sdp,
        this.socket(sessionId),
        input.onEvent,
        this.timing,
        () => this.emergencyClose(sessionId),
      );
      // Attach first so the server receives transcripts/delegation from the start.
      const ready = session.ready();
      if (input.onTransportReady) {
        try {
          await input.onTransportReady({
            externalSessionId: sessionId,
            sdpAnswer: created.transport.sdp,
          });
        } catch {
          await session.close();
          await ready.catch(() => {});
          throw new AiAdapterError('SDP_ANSWER_FAILED');
        }
      }
      await ready;
      return session;
    } catch {
      const cleanup = await (session?.close() ?? this.emergencyClose(sessionId));
      throw new AiAdapterError(
        cleanup.confirmed ? 'SIDEBAND_FAILED_CLOSED' : 'SIDEBAND_FAILED_CLOSE_UNCONFIRMED',
      );
    }
  }
}

class LiveSession implements ManagedVoiceSession {
  readonly externalSessionId: string;
  private started = false;
  private finalized = false;
  private disposed = false;
  private playbackActive = false;
  private closePromise: Promise<{ confirmed: boolean }> | undefined;
  private rescuePromise: Promise<void> | undefined;
  private resolveClose: ((result: { confirmed: boolean }) => void) | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout>;
  private startupTimer: ReturnType<typeof setTimeout>;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly delegations = new Set<string>();
  private readonly appendedIds = new Set<string>();
  private readonly pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    readonly sessionId: string,
    readonly sdpAnswer: string,
    private readonly socket: WebSocket,
    private readonly onEvent: CreateVoiceSessionInput['onEvent'],
    private readonly timing: Record<keyof typeof VOICE_LIMITS, number>,
    private readonly emergencyClose: () => Promise<{ confirmed: boolean }>,
  ) {
    this.externalSessionId = sessionId;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Attach a rejection handler immediately; caller may still be applying SDP.
    void this.readyPromise.catch(() => {});
    this.startupTimer = setTimeout(() => {
      this.rejectReady(new AiAdapterError('SIDEBAND_START_TIMEOUT'));
      void this.close();
    }, timing.startupMs);
    this.maxTimer = setTimeout(() => {
      void this.close();
    }, timing.maxDurationMs);
    socket.on('message', (data) => this.receive(data.toString()));
    socket.on('error', () => this.connectionLost());
    socket.on('close', () => this.connectionLost());
    this.markActivity();
  }
  ready(): Promise<void> {
    return this.readyPromise;
  }
  private emit(event: VoiceGatewayEvent): void {
    try {
      Promise.resolve(this.onEvent(event)).catch(() => {
        void this.close();
      });
    } catch {
      void this.close();
    }
  }
  markActivity(): void {
    if (this.disposed || this.closePromise) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.playbackActive) this.markActivity();
      else void this.close();
    }, this.timing.idleMs);
  }
  setPlaybackActive(active: boolean): void {
    this.playbackActive = active;
    this.markActivity();
  }

  private receive(raw: string): void {
    if (this.disposed) return;
    let value: z.infer<typeof eventSchema>;
    try {
      value = eventSchema.parse(JSON.parse(raw));
    } catch {
      this.emit({
        type: 'error',
        code: 'INVALID_LIVE_EVENT',
        message: '음성 이벤트 형식이 올바르지 않습니다.',
      });
      return;
    }
    const ackId = value.client_event_id;
    if (typeof ackId === 'string' && this.pending.has(ackId)) {
      const pending = this.pending.get(ackId)!;
      if (
        value.type === 'session.commentary.appended' ||
        value.type === 'session.thinking.appended' ||
        value.type === 'session.instructions.appended' ||
        value.type === 'error'
      ) {
        clearTimeout(pending.timer);
        this.pending.delete(ackId);
        if (value.type === 'error') pending.reject(new AiAdapterError('LIVE_APPEND_REJECTED'));
        else pending.resolve();
      }
    }
    if (value.type === 'session.started') {
      const session = value.session as { id?: unknown } | undefined;
      if (session?.id !== this.sessionId) {
        this.rejectReady(new AiAdapterError('LIVE_SESSION_MISMATCH'));
        void this.close();
        return;
      }
      if (!this.started) {
        this.started = true;
        clearTimeout(this.startupTimer);
        this.resolveReady();
        this.emit({ type: 'session.started', sessionId: this.sessionId });
      }
    } else if (
      (value.type === 'session.input_transcript.delta' ||
        value.type === 'session.output_transcript.delta') &&
      typeof value.delta === 'string'
    ) {
      this.markActivity();
      this.emit({
        type: value.type,
        delta: value.delta,
        ...(typeof value.start_ms === 'number' && typeof value.end_ms === 'number'
          ? { startMs: value.start_ms, endMs: value.end_ms }
          : {}),
      });
    } else if (value.type === 'session.delegation.created') {
      const delegation = value.delegation as { id?: unknown } | undefined;
      if (typeof delegation?.id === 'string' && !this.delegations.has(delegation.id)) {
        this.delegations.add(delegation.id);
        this.emit({ type: 'session.delegation.created', delegationId: delegation.id });
      }
    } else if (value.type === 'session.closed') {
      this.finalized = true;
      this.rejectReady(new AiAdapterError('SESSION_CLOSED'));
      this.emit({ type: 'session.closed' });
      this.finish(true);
    } else if (value.type === 'error') {
      // Provider messages can contain untrusted excerpts; expose a stable safe diagnostic.
      const error = value.error as { client_event_id?: unknown } | undefined;
      if (typeof error?.client_event_id === 'string') {
        const p = this.pending.get(error.client_event_id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(error.client_event_id);
          p.reject(new AiAdapterError('LIVE_APPEND_REJECTED'));
        }
      }
      this.emit({
        type: 'error',
        code: 'LIVE_PROVIDER_ERROR',
        message: '음성 제공자에서 오류가 발생했습니다.',
      });
      if (!this.started) {
        this.rejectReady(new AiAdapterError('LIVE_PROVIDER_ERROR'));
        void this.close();
      }
    } else if (
      value.type === 'session.input_audio.append' ||
      value.type === 'session.output_audio.delta'
    ) {
      const audio = value.type === 'session.input_audio.append' ? value.audio : value.delta;
      if (
        value.type === 'session.output_audio.delta' &&
        typeof audio === 'string' &&
        typeof value.start_ms === 'number' &&
        typeof value.end_ms === 'number'
      ) {
        this.emit({
          type: 'session.output_audio.delta',
          delta: audio,
          startMs: value.start_ms,
          endMs: value.end_ms,
        });
      }
      // Reflected PCM includes continuous silence; silence must not keep the session alive.
      if (typeof audio === 'string' && hasAudiblePcm(audio)) this.markActivity();
    }
  }

  private connectionLost(): void {
    if (this.disposed || this.finalized) return;
    this.rejectReady(new AiAdapterError('SIDEBAND_DISCONNECTED'));
    this.emit({ type: 'disconnected' });
    if (this.closePromise) this.rescueClose();
    else void this.close();
  }
  private rescueClose(): void {
    this.rescuePromise ??= this.emergencyClose().then((result) => this.finish(result.confirmed));
  }
  appendCommentary(input: { delegationId: string | null; content: string }): Promise<void> {
    return this.append({ type: 'session.commentary.append', eventId: randomUUID(), ...input });
  }
  appendThinking(input: { delegationId: string | null; content: string }): Promise<void> {
    return this.append({ type: 'session.thinking.append', eventId: randomUUID(), ...input });
  }
  async append(input: VoiceAppendInput): Promise<void> {
    if (
      !this.started ||
      this.disposed ||
      this.closePromise ||
      this.socket.readyState !== WebSocket.OPEN
    )
      throw new AiAdapterError('VOICE_NOT_READY');
    if (
      ![
        'session.commentary.append',
        'session.thinking.append',
        'session.instructions.append',
      ].includes(input.type)
    )
      throw new AiAdapterError('INVALID_APPEND_TYPE');
    if (input.delegationId !== null && !this.delegations.has(input.delegationId))
      throw new AiAdapterError('UNKNOWN_DELEGATION');
    if (
      !input.eventId ||
      typeof input.content !== 'string' ||
      input.content.length > 8_000 ||
      this.appendedIds.has(input.eventId)
    )
      throw new AiAdapterError('INVALID_APPEND');
    this.appendedIds.add(input.eventId);
    // Only speakable updates count as activity. Thinking can continue while the user is silent.
    if (input.type === 'session.commentary.append') this.markActivity();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(input.eventId);
        reject(new AiAdapterError('LIVE_APPEND_TIMEOUT'));
      }, this.timing.appendMs);
      this.pending.set(input.eventId, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          type: input.type,
          event_id: input.eventId,
          delegation_id: input.delegationId,
          content: input.content,
        }),
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(input.eventId);
            reject(new AiAdapterError('LIVE_APPEND_FAILED'));
          }
        },
      );
    });
  }
  close(): Promise<{ confirmed: boolean }> {
    if (this.finalized) return Promise.resolve({ confirmed: true });
    if (this.closePromise) return this.closePromise;
    this.closePromise = new Promise((resolve) => {
      this.resolveClose = resolve;
    });
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.startupTimer);
    this.rejectReady(new AiAdapterError('SESSION_CLOSING'));
    this.closeTimer = setTimeout(() => this.finish(false), this.timing.closeMs);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({ type: 'session.close', event_id: randomUUID() }),
        (error) => {
          if (error) this.rescueClose();
        },
      );
    } else {
      this.rescueClose();
    }
    return this.closePromise;
  }
  private finish(confirmed: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finalized = confirmed;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.closeTimer);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new AiAdapterError('SESSION_CLOSED'));
    }
    this.pending.clear();
    this.delegations.clear();
    this.appendedIds.clear();
    this.socket.removeAllListeners();
    this.socket.on('error', () => {});
    this.socket.terminate();
    this.resolveClose?.({ confirmed });
  }
}

function hasAudiblePcm(base64: string): boolean {
  const bytes = Buffer.from(base64, 'base64');
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const value = bytes.readInt16LE(i);
    sum += value * value;
    count++;
  }
  return count > 0 && Math.sqrt(sum / count) > 300;
}

export const VoiceGateway = OpenAiVoiceGateway;
export function createVoiceGateway(
  env: AiEnvironment = process.env,
  options: VoiceGatewayOptions = {},
): OpenAiVoiceGateway {
  return new OpenAiVoiceGateway(env, options);
}
