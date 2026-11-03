import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.js';
export async function startMock() {
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledFrame: 'bypass',
    quiet: true,
  });
}
