import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Mobile screen tests render the mounted components through react-native-web
// so Vitest can exercise the real screens without a Metro/native runtime.
export default defineConfig({
  root: path.resolve(__dirname),
  // The screen tests are source-only and must not load repository secrets or
  // a root deployment .env while Vitest resolves its config.
  envDir: path.resolve(__dirname, 'packages/mobile'),
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'react-native': path.resolve(__dirname, 'packages/mobile/node_modules/react-native-web'),
      '@axiom/core': path.resolve(__dirname, 'packages/core/src'),
      '@axiom/api': path.resolve(__dirname, 'packages/api/src'),
    },
  },
  test: { environment: 'node', include: ['packages/mobile/**/*.test.tsx'] },
});
