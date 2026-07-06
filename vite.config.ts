import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base matches the GitHub Pages project path.
export default defineConfig({
  base: '/seans-week/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png'],
      manifest: {
        name: "Sean's Week",
        short_name: "Sean's Week",
        description:
          'A weekly calendar built around ordo vitae — the well-ordered life — with Hermes as the interface.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        // Vase theme: dark parchment ground.
        background_color: '#201b15',
        theme_color: '#201b15',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + all built assets (including the Hermes artwork).
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,webmanifest}'],
        // Live data stays live: Google APIs are network-first with a short
        // fallback cache so an offline open still shows something recent.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(www|gmail)\.googleapis\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'google-apis',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});
