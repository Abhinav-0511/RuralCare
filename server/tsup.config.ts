import { defineConfig } from 'tsup';

// @ruralcare/shared ships TypeScript source + JSON, so it is bundled into the server output.
// Everything else in node_modules stays external.
export default defineConfig({
  // dist/index.js (API), dist/seed.js (demo data), dist/cleanupOrphanVitals.js (maintenance)
  entry: {
    index: 'src/index.ts',
    seed: 'src/scripts/seed.ts',
    cleanupOrphanVitals: 'src/scripts/cleanupOrphanVitals.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@ruralcare\//],
});
