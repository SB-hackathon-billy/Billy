import { Database } from '@sb/db';
import { RentalWorker, classifyError, type WorkerLog } from './worker.js';

const log: WorkerLog = (event, fields) => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
};
const db = new Database();
let worker: RentalWorker | undefined;
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    await worker?.stop();
    await db.close();
  })().catch((error: unknown) => {
    log('shutdown.error', classifyError(error));
    process.exitCode = 1;
  });
  return stopping;
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
try {
  worker = new RentalWorker({ db, log });
  await worker.start();
} catch (error) {
  log('startup.error', classifyError(error));
  process.exitCode = 1;
  await stop();
}
