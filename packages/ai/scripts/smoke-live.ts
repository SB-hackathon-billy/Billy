import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import WebSocket from 'ws';
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } from 'werift';
import {
  AI_FIXTURES,
  OpenAiTransport,
  portsFromTransport,
  OpenAiVoiceGateway,
  readAiConfig,
  errorSummary,
} from '../src/index.js';
import type { AiTaskInput } from '@sb/contracts';

const config = readAiConfig({ ...process.env, AI_MODE: 'live' });
const timestamp = new Date().toISOString().replaceAll(':', '-');
const directory = new URL(`../fixtures/live-runs/${timestamp}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const save = (name: string, data: unknown) =>
  writeFile(new URL(`${name}.json`, directory), JSON.stringify(data, null, 2) + '\n');
let sequence = 0;
// Request headers are never inspected or persisted. Provider exceptions are never serialized.
const auditFetch: typeof fetch = async (request, init) => {
  const number = ++sequence;
  const start = performance.now();
  const path = new URL(
    typeof request === 'string' || request instanceof URL ? request : request.url,
  ).pathname;
  const input = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
  try {
    const response = await fetch(request, init);
    const output: unknown = await response.clone().json();
    await save(`wire-${number}`, {
      path,
      input,
      status: response.status,
      latencyMs: Math.round(performance.now() - start),
      output,
    });
    return response;
  } catch (error) {
    await save(`wire-${number}`, {
      path,
      input,
      latencyMs: Math.round(performance.now() - start),
      error: errorSummary(error),
    });
    throw error;
  }
};
const client = new OpenAI({
  apiKey: config.apiKey!,
  maxRetries: 0,
  timeout: config.timeoutMs,
  fetch: auditFetch,
});
const ports = portsFromTransport(new OpenAiTransport(client, config));
const results: {
  name: string;
  success: boolean;
  latencyMs: number;
  output?: unknown;
  error?: unknown;
}[] = [];
async function run(name: string, input: unknown, call: () => Promise<unknown>) {
  const start = performance.now();
  await save(`${name}-input`, input);
  try {
    const output = await call();
    const row = {
      name,
      success: output !== null,
      latencyMs: Math.round(performance.now() - start),
      output,
    };
    results.push(row);
    await save(`${name}-output`, row);
    console.log(`${name}: ${row.success ? 'PASS' : 'BASELINE_FALLBACK'} (${row.latencyMs} ms)`);
  } catch (error) {
    const row = {
      name,
      success: false,
      latencyMs: Math.round(performance.now() - start),
      error: errorSummary(error),
    };
    results.push(row);
    await save(`${name}-output`, row);
    console.log(`${name}: FAIL ${row.error.code} (${row.latencyMs} ms)`);
  }
}
for (const kind of (process.argv.includes('--only-live')
  ? []
  : ['ROUTE_INTENT', 'EXTRACT_NEED', 'RECOMMEND_FEE']) as readonly (
  'ROUTE_INTENT' | 'EXTRACT_NEED' | 'RECOMMEND_FEE'
)[]) {
  const input: AiTaskInput = structuredClone(AI_FIXTURES[kind].input);
  input.serverNow = new Date().toISOString();
  await run(kind.toLowerCase(), input, () => ports.runTask(input));
}

const peer = new RTCPeerConnection({ iceServers: [] });
const events: unknown[] = [];
let audioTimer: ReturnType<typeof setInterval> | undefined;
const audioTrack = new MediaStreamTrack({ kind: 'audio' });
try {
  peer.addTransceiver(audioTrack, { direction: 'sendrecv' });
  const channel = peer.createDataChannel('oai-events');
  channel.onMessage.subscribe((data) => {
    try {
      const event = JSON.parse(data.toString()) as { type: string };
      if (['session.started', 'session.closed', 'error'].includes(event.type))
        events.push({ source: 'data-channel', event });
    } catch {
      /* Binary/audio is not persisted. */
    }
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const sdpOffer = peer.localDescription?.sdp;
  if (!sdpOffer) throw new Error('SDP_OFFER_MISSING');
  await run('live', { requestId: 'req_live_smoke', actorUserId: 'u_hana', sdpOffer }, async () => {
    const gateway = new OpenAiVoiceGateway(
      { ...process.env, AI_MODE: 'live' },
      {
        client,
        socketFactory: (url, options) => {
          const socket = new WebSocket(url, options);
          socket.on('message', (data) => {
            try {
              const event = JSON.parse(data.toString()) as { type: string };
              if (!event.type.includes('audio.'))
                events.push({ source: 'provider-sideband', event });
            } catch {
              /* Diagnostics never persist binary audio. */
            }
          });
          return socket;
        },
      },
    );
    const session = await gateway.createSession({
      requestId: 'req_live_smoke',
      actorUserId: 'u_hana',
      sdpOffer,
      instructions: '이 연결은 기술 검증이다. 먼저 말하지 말고 사용자의 말을 기다린다.',
      onEvent: (event) => {
        events.push({ source: 'sideband', event });
      },
    });
    try {
      // Match the browser HTTP flow: apply the answer only after gateway readiness.
      events.push({ source: 'smoke', event: { type: 'sdp.answer.applying.after.gateway.ready' } });
      await peer.setRemoteDescription({ type: 'answer', sdp: session.sdpAnswer });
      let sequenceNumber = 0;
      let rtpTimestamp = 0;
      // Real RTP Opus silence keeps the media clock advancing without recording a microphone.
      audioTimer = setInterval(() => {
        if (peer.connectionState !== 'connected') return;
        audioTrack.writeRtp(
          new RtpPacket(
            new RtpHeader({
              payloadType: 111,
              sequenceNumber: sequenceNumber++ % 65536,
              timestamp: rtpTimestamp,
              ssrc: 12345678,
            }),
            Buffer.from([0xf8, 0xff, 0xfe]),
          ),
        );
        rtpTimestamp += 960;
      }, 20);
      await session.appendThinking({
        delegationId: null,
        content: '연결 확인 중이며 실제 결제와 예약이 이루어지지 않습니다.',
      });
    } finally {
      const close = await session.close();
      await save('live-events', events);
      if (!close.confirmed) throw new Error('LIVE_CLOSE_UNCONFIRMED');
    }
    return {
      externalSessionId: session.externalSessionId,
      sdpAnswer: session.sdpAnswer,
      closed: true,
      events,
      limitation:
        'Node WebRTC 연결·sideband·append·종료만 확인. 실제 마이크·한국어 음질·휴대폰 호환성은 미검증.',
    };
  });
} catch (error) {
  if (!results.some((row) => row.name === 'live'))
    results.push({ name: 'live', success: false, latencyMs: 0, error: errorSummary(error) });
} finally {
  clearInterval(audioTimer);
  audioTrack.stop();
  await save('live-events', events);
  await peer.close();
}
await save('summary', {
  timestamp,
  sdk: 'openai@7.47.0',
  models: { agent: config.agentModel, decision: config.decisionModel, voice: config.voiceModel },
  results,
});
console.log(`Artifacts: ${fileURLToPath(directory)}`);
process.exitCode = results.every((row) => row.success) ? 0 : 1;
// werift may retain ICE retransmission timers after close; all artifacts are flushed above.
process.exit(process.exitCode);
