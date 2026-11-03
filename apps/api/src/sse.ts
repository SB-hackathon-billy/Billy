import type { FastifyInstance } from 'fastify';
import { EventsQuerySchema, EventCursorSchema, type SseEvent } from '@sb/contracts';
export async function registerEvents(app: FastifyInstance, heartbeatMs: number) {
  const { db, requireSession } = app.demo;
  const listener = await db.pool.connect();
  await listener.query('LISTEN sb_events');
  const streams = new Set<{ userId: string; wake: () => void; close: () => void }>();
  listener.on('notification', (msg) => {
    if (msg.channel !== 'sb_events') return;
    let users: string[];
    try {
      users = JSON.parse(msg.payload ?? '[]') as string[];
    } catch {
      return;
    }
    for (const stream of streams) if (users.includes(stream.userId)) stream.wake();
  });
  // A periodic drain also recovers from a dropped NOTIFY; payload remains in the durable event log.
  listener.on('error', () => {
    for (const stream of streams) stream.wake();
  });
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.close();
    await listener.query('UNLISTEN sb_events').catch(() => {});
    listener.release();
  });
  app.get('/api/v1/events', async (request, reply) => {
    const session = requireSession(request);
    const q = EventsQuerySchema.parse(request.query);
    const header = request.headers['last-event-id'];
    let cursor = EventCursorSchema.parse(typeof header === 'string' ? header : (q.after ?? '0'));
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();
    let closed = false;
    let running = false;
    let pending = false;
    const write = (type: string, data: unknown, eventId?: string) => {
      if (!closed)
        reply.raw.write(
          `${eventId ? `id: ${eventId}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
        );
    };
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      streams.delete(stream);
      reply.raw.end();
    };
    const drain = async () => {
      if (closed) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        do {
          pending = false;
          let valid = true;
          try {
            await db.transaction((u) => u.session(request.cookies[app.demo.cookieName]));
          } catch {
            valid = false;
          }
          if (!valid) {
            await db.transaction((u) => u.revokeSession(session.id, session.userId));
            const revokedBatch = await db.eventsAfter(session.userId, cursor);
            const revoked = (revokedBatch.events as SseEvent[]).findLast(
              (event) => event.type === 'session.revoked',
            );
            if (revoked) write('session.revoked', revoked, revoked.eventId);
            else
              write('session.revoked', {
                eventId: revokedBatch.cursor,
                eventVersion: 1,
                type: 'session.revoked',
                occurredAt: db.now().toISOString(),
                reason: 'SESSION_REVOKED',
              });
            close();
            break;
          }
          const batch = await db.eventsAfter(session.userId, cursor);
          if (batch.expired) {
            write('sync.required', {
              eventId: batch.cursor,
              eventVersion: 1,
              type: 'sync.required',
              occurredAt: db.now().toISOString(),
              reason: 'CURSOR_EXPIRED',
            });
            close();
            break;
          }
          for (const event of batch.events as SseEvent[]) {
            cursor = event.eventId;
            if (event.type === 'session.revoked') continue;
            write(event.type, event, event.eventId);
          }
        } while (pending && !closed);
      } catch {
        close();
      } finally {
        running = false;
      }
    };
    const heartbeat = setInterval(
      () => write('heartbeat', { serverTime: db.now().toISOString() }),
      heartbeatMs,
    );
    const poll = setInterval(() => {
      void drain();
    }, 1_000);
    const stream = {
      userId: session.userId,
      wake: () => {
        void drain();
      },
      close,
    };
    streams.add(stream);
    request.raw.on('close', close);
    reply.raw.on('close', close);
    await drain();
  });
}
