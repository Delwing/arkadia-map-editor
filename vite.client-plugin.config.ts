import { defineConfig } from 'vite';

/**
 * Builds the Arkadia web-client plugin as a standalone ES module.
 *
 * Output goes to `public/`, so `vite build` copies it into `dist/` and the dev
 * server serves it at `/client-plugin.js` — the same relative location the
 * plugin expects `bridge.html` to sit next to. The user pastes that URL into
 * the web client's script list.
 */
export default defineConfig({
  // Output *is* public/; without this Vite warns about outDir === publicDir.
  publicDir: false,
  build: {
    outDir: 'public',
    // public/ holds committed assets (favicon, logo, bridge.html) — never wipe it.
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/client-plugin/index.ts',
      formats: ['es'],
      fileName: () => 'client-plugin.js',
    },
    rollupOptions: {
      output: { entryFileNames: 'client-plugin.js' },
    },
  },
});
