// 통화 발화로 신청완료 화면의 관련 센터 정책을 고른다. 명세: docs/specs/0005-call-policy-guidance.md
// 상태를 바꾸지 않는 계산이라 멱등 저장(mutation)을 쓰지 않고, 발화는 저장·로그하지 않는다.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as C from '@sb/contracts';
import { fail } from '@sb/db';
import { createPolicyMatcher, errorSummary, type PolicyMatcher } from '@sb/ai';

export default async function policyMatchesPlugin(app: FastifyInstance) {
  const { envelope, requireSession, cookieName } = app.demo;
  let matcher: PolicyMatcher | undefined;
  app.post(
    '/api/v1/policy-matches',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          // Behind the proxy every caller shares one IP, so count per session (token hashed).
          keyGenerator: (request) => {
            const token = request.cookies[cookieName];
            return token
              ? `policy:${createHash('sha256').update(token).digest('hex')}`
              : request.ip;
          },
        },
      },
    },
    async (request) => {
      requireSession(request);
      const { utterances } = C.PolicyMatchBodySchema.parse(request.body);
      let match: C.PolicyMatch;
      try {
        matcher ??= createPolicyMatcher();
        match = await matcher(utterances);
      } catch (error) {
        request.log.warn({ code: errorSummary(error).code }, 'policy match AI failed');
        fail('AI_UNAVAILABLE');
      }
      return envelope(match);
    },
  );
}
