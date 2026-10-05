/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'RuralCare',
        short_name: 'RuralCare',
        description: 'Offline-first symptom triage for rural patients (English, தமிழ், हिंदी)',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#115e59',
        background_color: '#115e59',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + every lazy chunk: the whole app opens offline after the first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // The model is versioned by sha256 and stored in IndexedDB by the app (see modelManager.ts).
        // ...and the onnxruntime-web fallback is fetched only if a model ever needs it.
        // Charts are only used by online dashboards: cached the first time they're opened, not upfront.
        globIgnores: ['models/**', '**/ort*.js', '**/*.wasm', '**/charts-*.js'],
        navigateFallbackDenylist: [/^\/models\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(charts-|ort).*\.(js|wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'ruralcare-lazy-assets', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Recharts is split out naturally (only lazy dashboards import it). Only its NAME is set, so the
        // service worker can skip precaching it; forcing a manual chunk would drag React into it.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('node_modules/recharts'))
            ? 'assets/charts-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
