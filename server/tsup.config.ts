import { defineConfig } from 'tsup';

// @ruralcare/shared ships TypeScript source + JSON, so it is bundled into the server output.
// Everything else in node_modules stays external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@ruralcare\//],
});
