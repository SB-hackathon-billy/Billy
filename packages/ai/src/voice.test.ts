import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { VoiceGatewayEvent } from '@sb/contracts';
import {
  OpenAiVoiceGateway,
  voiceStatusForEvent,
  type ManagedVoiceSession,
  type VoiceGatewayOptions,
} from './voice.js';

const resources: { server: WebSocketServer; session?: ManagedVoiceSession }[] = [];
afterEach(async () => {
  for (const { server, session } of resources.splice(0)) {
    await session?.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(
  options: {
    started?: boolean;
    ack?: boolean;
    closeAck?: boolean;
    timing?: VoiceGatewayOptions['timing'];
  } = {},
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const resource: (typeof resources)[number] = { server };
  resources.push(resource);
  const port = (server.address() as AddressInfo).port;
  const received: Record<string, unknown>[] = [];
  const events: VoiceGatewayEvent[] = [];
  const sockets: WebSocket[] = [];
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(event);
      if (event.type === 'session.close' && options.closeAck !== false)
        socket.send(JSON.stringify({ type: 'session.closed' }));
      if (String(event.type).endsWith('.append') && options.ack !== false)
        socket.send(
          JSON.stringify({
            type: String(event.type).replace('.append', '.appended'),
            client_event_id: event.event_id,
          }),
        );
    });
    if (options.started !== false)
      socket.send(
        JSON.stringify({ type: 'session.started', session: { id: 'live_exact-provider-id' } }),
      );
  });
  const fetcher = vi.fn(async (_request: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.session.model).toBe('gpt-live-1');
    expect(body.session.delegation).toEqual({ type: 'client' });
    expect(body.transport).toEqual({ type: 'webrtc', sdp: 'test-sdp-offer' });
    expect(body.session.client.data_channel.allowed_client_events).not.toContain(
      'session.thinking.append',
    );
    expect(body.session).not.toHaveProperty('tools');
    return Response.json(
      {
        session: { id: 'live_exact-provider-id' },
        transport: { type: 'webrtc', sdp: 'test-sdp-answer' },
      },
      { status: 201 },
    );
  });
  const gateway = new OpenAiVoiceGateway(
    { AI_MODE: 'live', OPENAI_API_KEY: 'test-only-key' },
    {
      client: new OpenAI({ apiKey: 'test-only-key', fetch: fetcher }),
      socketFactory: (url, opts) => {
        expect(url).toBe('wss://api.openai.com/v1/live/sessions/live_exact-provider-id/attach');
        expect(opts.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
        return new WebSocket(`ws://127.0.0.1:${port}`, opts);
      },
      timing: {
        startupMs: 500,
        closeMs: 100,
        appendMs: 100,
        maxDurationMs: 2000,
        idleMs: 1000,
        ...options.timing,
      },
    },
  );
  const start = async () => {
    resource.session = await gateway.createSession({
      requestId: 'req_voice',
      actorUserId: 'u_hana',
      sdpOffer: 'test-sdp-offer',
      tools: [{ name: 'read_request', description: '내 요청 조회' }],
      onEvent: (event) => {
        events.push(event);
      },
    });
    return resource.session;
  };
  return { gateway, start, events, received, sockets, fetcher };
}

describe('GPT-Live sideband and contract boundary', () => {
  it('waits for session.started, preserves ID, maps transcripts and deduplicates delegation IDs', async () => {
    const f = await fixture();
    const session = await f.start();
    expect(session.sessionId).toBe('live_exact-provider-id');
    expect(session.externalSessionId).toBe(session.sessionId);
    expect(session.sdpAnswer).toBe('test-sdp-answer');
    const socket = f.sockets[0]!;
    for (const event of [
      { type: 'session.input_transcript.delta', delta: '프로젝터' },
      { type: 'session.output_transcript.delta', delta: '언제 필요하세요?' },
      { type: 'session.delegation.created', delegation: { id: 'item_delegation' } },
      { type: 'session.delegation.created', delegation: { id: 'item_delegation' } },
    ])
      socket.send(JSON.stringify(event));
    await vi.waitFor(() => expect(f.events).toHaveLength(4));
    await session.appendCommentary({
      delegationId: 'item_delegation',
      content: '승인 상태는 서버 카드에서 확인해 주세요.',
    });
    expect(f.received[0]).toMatchObject({
      type: 'session.commentary.append',
      delegation_id: 'item_delegation',
    });
    expect(f.received[0]?.event_id).toEqual(expect.any(String));
    expect(f.received.some((event) => event.type === 'session.start')).toBe(false);
    expect(await session.close()).toEqual({ confirmed: true });
    expect(await session.close()).toEqual({ confirmed: true });
    expect(f.received.filter((event) => event.type === 'session.close')).toHaveLength(1);
  });
  it('general context uses null delegation and unknown or prior-session IDs are rejected', async () => {
    const f = await fixture();
    const session = await f.start();
    await session.appendThinking({ delegationId: null, content: '조회 중' });
    expect(f.received[0]?.delegation_id).toBeNull();
    await expect(
      session.appendThinking({ delegationId: 'old-session-item', content: '오래된 결과' }),
    ).rejects.toThrow('UNKNOWN_DELEGATION');
    expect(f.received).toHaveLength(1);
  });
  it('append waits for matching acknowledgement, then times out cleanly', async () => {
    const f = await fixture({ ack: false, timing: { appendMs: 30 } });
    const session = await f.start();
    const append = session.append({
      type: 'session.thinking.append',
      eventId: 'event_pending',
      delegationId: null,
      content: '조회 중',
    });
    f.sockets[0]!.send(
      JSON.stringify({ type: 'session.thinking.appended', client_event_id: 'wrong' }),
    );
    await expect(append).rejects.toThrow('LIVE_APPEND_TIMEOUT');
    expect(await session.close()).toEqual({ confirmed: true });
  });
  it('nested provider client_event_id rejects only that append', async () => {
    const f = await fixture({ ack: false });
    const session = await f.start();
    const append = session.append({
      type: 'session.thinking.append',
      eventId: 'event_reject',
      delegationId: null,
      content: '조회 중',
    });
    const assertion = expect(append).rejects.toThrow('LIVE_APPEND_REJECTED');
    f.sockets[0]!.send(
      JSON.stringify({
        type: 'error',
        error: { client_event_id: 'event_reject', message: 'untrusted provider detail' },
      }),
    );
    await assertion;
    expect(f.events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      code: 'LIVE_PROVIDER_ERROR',
      message: '음성 제공자에서 오류가 발생했습니다.',
    });
  });
  it('missing session.started fails and closes the created remote session', async () => {
    const f = await fixture({ started: false, timing: { startupMs: 30 } });
    await expect(f.start()).rejects.toThrow('SIDEBAND_FAILED_CLOSED');
    expect(f.received.some((event) => event.type === 'session.close')).toBe(true);
  });
  it('unconfirmed close returns false within policy bound', async () => {
    const f = await fixture({ closeAck: false, timing: { closeMs: 30 } });
    const session = await f.start();
    expect(await session.close()).toEqual({ confirmed: false });
    await expect(session.appendThinking({ delegationId: null, content: 'closed' })).rejects.toThrow(
      'VOICE_NOT_READY',
    );
  });
  it('sideband disconnect reattaches solely to close and reports RECONNECT_REQUIRED', async () => {
    const f = await fixture();
    const session = await f.start();
    f.sockets[0]!.terminate();
    await vi.waitFor(() =>
      expect(f.received.some((event) => event.type === 'session.close')).toBe(true),
    );
    expect(f.events).toContainEqual({ type: 'disconnected' });
    expect(await session.close()).toEqual({ confirmed: true });
  });
  it('continuous silent PCM does not defeat idle timeout', async () => {
    const f = await fixture({ timing: { idleMs: 70 } });
    await f.start();
    const interval = setInterval(() => {
      if (f.sockets[0]?.readyState === WebSocket.OPEN)
        f.sockets[0].send(
          JSON.stringify({
            type: 'session.input_audio.append',
            audio: Buffer.alloc(960).toString('base64'),
          }),
        );
    }, 10);
    try {
      await vi.waitFor(() =>
        expect(f.received.some((event) => event.type === 'session.close')).toBe(true),
      );
    } finally {
      clearInterval(interval);
    }
  });
  it('playback prevents idle close, while maximum duration always closes', async () => {
    const f = await fixture({ timing: { idleMs: 25, maxDurationMs: 120 } });
    const session = await f.start();
    session.setPlaybackActive(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(f.received.some((event) => event.type === 'session.close')).toBe(false);
    await vi.waitFor(() =>
      expect(f.received.some((event) => event.type === 'session.close')).toBe(true),
    );
  });
  it('maps only contract voiceStatus values and refuses authoritative tools', async () => {
    expect(voiceStatusForEvent({ type: 'session.started', sessionId: 'live_id' })).toBe(
      'LISTENING',
    );
    expect(voiceStatusForEvent({ type: 'session.output_transcript.delta', delta: '안내' })).toBe(
      'SPEAKING',
    );
    expect(voiceStatusForEvent({ type: 'disconnected' })).toBe('RECONNECT_REQUIRED');
    expect(voiceStatusForEvent({ type: 'session.closed' })).toBe('CLOSED');
    const f = await fixture();
    await expect(
      f.gateway.createSession({
        requestId: 'req_voice',
        actorUserId: 'u_hana',
        sdpOffer: 'test-sdp-offer',
        onEvent: () => {},
        tools: [{ name: 'select_offer', description: '선택' }],
      }),
    ).rejects.toThrow('FORBIDDEN_VOICE_TOOL');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(() => new OpenAiVoiceGateway({ AI_MODE: 'fixture' })).toThrow('requires AI_MODE=live');
  });
});
