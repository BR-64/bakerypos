/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'Bakery POS',
        short_name: 'POS',
        description: 'Offline-first point of sale for a small bakery kiosk',
        theme_color: '#7c4a1e',
        background_color: '#fff8f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // The PNGs are what Android and iOS actually install with (both
        // ignore an SVG in one place or another), and they are the
        // maskable pair: generated full-bleed, with the bread inside the
        // middle 80% a launcher mask may crop to — see
        // `scripts/generate-icons.mjs`, which regenerates them from the
        // SVG. The SVG stays for anything that prefers a scalable icon,
        // but as `any` only: its rounded corners are transparent, so a
        // square mask would show them.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // The whole app shell is precached so checkout works with no network.
        //
        // `webp`, `jpg` and `jpeg` are here for the product pictures
        // shipped in `public/products/` (see its README). They were *not*
        // covered before — the list was js/css/html/svg/png/woff2 — so
        // without them a tile picture would have been the one thing on the
        // Sell screen that needed the network. Photos the owner uploads in
        // Admin are in IndexedDB and are nothing to do with the service
        // worker.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,jpeg,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
