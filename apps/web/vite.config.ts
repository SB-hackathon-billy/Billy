import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'development-mock-worker',
      apply: 'serve',
      configureServer(server) {
        if (process.env.VITE_API_MOCK !== '1') return;
        const require = createRequire(import.meta.url);
        const worker = readFileSync(
          join(dirname(require.resolve('msw/package.json')), 'lib/mockServiceWorker.js'),
        );
        server.middlewares.use('/mockServiceWorker.js', (_request, response) => {
          response.setHeader('Content-Type', 'application/javascript');
          response.end(worker);
        });
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: '성북 공유대여',
        short_name: '성북 공유대여',
        lang: 'ko',
        description: '필요한 물품을 함께 찾고 조건을 비교하는 공유대여 데모',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#253C52',
        background_color: '#F8F7F1',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2}', 'content/center/**/*.json'],
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /^\/api(?:\/|$)/.test(url.pathname),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin && /^\/content\/center\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'public-center-content',
              expiration: { maxEntries: 40, maxAgeSeconds: 86_400 * 30 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
