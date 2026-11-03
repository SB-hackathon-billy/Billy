import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from 'react-aria-components';
import { App } from './App.js';
import { SessionProvider } from './lib/session.js';
import { ApiError } from './lib/api.js';
import './styles/tokens.css';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 1 && error instanceof ApiError && error.code === 'NETWORK',
      staleTime: 0,
    },
    mutations: { retry: false },
  },
});
if (import.meta.env.DEV && import.meta.env.VITE_API_MOCK === '1') {
  const { startMock } = await import('./mocks/browser.js');
  await startMock();
}
const root = document.getElementById('root');
if (!root) throw new Error('앱 root를 찾을 수 없습니다.');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="ko-KR">
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
