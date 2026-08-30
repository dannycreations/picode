import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { buildStaticAssets } from './scripts/assets.ts';

const srcDir = resolve(import.meta.dirname, 'src');

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    plugins: [
      react(),
      isBuild && {
        name: 'pi-code:static-assets',
        closeBundle: buildStaticAssets,
      },
    ].filter(Boolean),
    build: {
      lib: {
        entry: resolve(srcDir, 'index.tsx'),
        formats: ['iife'],
        name: 'webview',
        fileName: () => 'webview.cjs',
      },
      outDir: 'dist',
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      target: 'chrome120',
      rolldownOptions: {
        output: {
          exports: 'none',
        },
      },
    },
    resolve: {
      alias: {
        '@pi-code/webview': srcDir,
        '@pi-code/shared': resolve(import.meta.dirname, '../extension/src/shared'),
      },
    },
    define: isBuild ? { 'process.env.NODE_ENV': '"production"' } : {},
    test: {
      include: ['src/**/*.{test,spec}.{ts,mts,cts}'],
      watch: false,
      testTimeout: 10_000,
    },
  };
});
