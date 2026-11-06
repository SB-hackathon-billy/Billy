// 3번 거점 인계·반납 API. 명세: docs/specs/0007-hub-handover-return.md
// 거점 관리자만 쓴다. 쓰기는 기존 mutation 래퍼(세션·CSRF·Idempotency-Key)를 쓰고 규칙은 @sb/db에 있다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as C from '@sb/contracts';
import { getHandover, recordInspection, recordPickup, recordReturn } from '@sb/db';
import { createReturnInspector, type ReturnInspector } from '@sb/ai';

export default async function handoversPlugin(app: FastifyInstance) {
  const { db, envelope, requireSession, mutation } = app.demo;
  let inspector: ReturnInspector | undefined;
  const code = (request: FastifyRequest) =>
    C.HandoverCodeSchema.parse((request.params as { code: string }).code);

  app.get('/api/v1/handovers/:code', async (request) =>
    envelope(
      await db.transaction((u) => getHandover(u, requireSession(request).userId, code(request))),
    ),
  );
  mutation('POST', '/handovers/:code/pickup', 200, (u, request) =>
    recordPickup(
      u,
      requireSession(request).userId,
      code(request),
      C.HandoverPhotoBodySchema.parse(request.body),
    ),
  );
  mutation('POST', '/handovers/:code/return', 200, (u, request) =>
    recordReturn(
      u,
      requireSession(request).userId,
      code(request),
      C.HandoverPhotoBodySchema.parse(request.body),
      (before, after) => (inspector ??= createReturnInspector())(before, after),
    ),
  );
  mutation('POST', '/handovers/:code/inspect', 200, (u, request) =>
    recordInspection(
      u,
      requireSession(request).userId,
      code(request),
      C.InspectBodySchema.parse(request.body),
    ),
  );
}
