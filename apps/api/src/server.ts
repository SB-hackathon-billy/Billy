import { buildApi } from './index.js';
import { createAiPorts } from '@sb/ai';
import { Database } from '@sb/db';
const db = new Database({ feeRecommender: createAiPorts().feeRecommender });
// 자동 e2e는 세 데모 사용자를 한 프록시(Caddy) IP로 보내 분당 120회 한도를 함께 쓴다.
// 그 모드에서만 한도를 높이고, 데모·운영 모드의 한도는 그대로 둔다(명세 0004).
const app = await buildApi({
  db,
  logger: true,
  ...(process.env.APP_MODE === 'automated-test' ? { rateLimitMax: 1_000 } : {}),
  // ponytail: 공개 배포도 모든 사용자가 Caddy IP 하나로 한도를 공유한다. 사용자별 한도가 필요하면 trustProxy로 전환.
  ...(process.env.RATE_LIMIT_MAX ? { rateLimitMax: Number(process.env.RATE_LIMIT_MAX) } : {}),
});
app.addHook('onClose', async () => db.close());
const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
