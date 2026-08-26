import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';


export default defineConfig({
  base: './',
  server: {
    // The Arkadia web client imports `client-plugin.js` from here as an ES
    // module, and module scripts require CORS (classic scripts do not — which is
    // why a missing header shows up as a bogus "Unexpected token 'export'" from
    // the client's legacy <script> fallback rather than as a CORS error).
    //
    // Two dev setups need allowing: the client running locally, and — the usual
    // case — the *published* client at delwing.github.io driving a local editor.
    // Chrome treats http://localhost as trustworthy, so that https→http load is
    // not blocked as mixed content.
    cors: {
      origin: [
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
        'https://delwing.github.io',
      ],
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'events', 'stream', 'process', 'util'],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'i18next', 'react-i18next'],
    alias: {
      'vite-plugin-node-polyfills/shims/buffer': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js', import.meta.url)
      ),
      'vite-plugin-node-polyfills/shims/process': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js', import.meta.url)
      ),
      'vite-plugin-node-polyfills/shims/global': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js', import.meta.url)
      ),
    },
  }
});
