import { buildApi } from './index.js';
import { createAiPorts } from '@sb/ai';
import { Database } from '@sb/db';
const db = new Database({ feeRecommender: createAiPorts().feeRecommender });
const app = await buildApi({ db, logger: true });
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
