import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import checker from 'vite-plugin-checker';
import { configDefaults } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      !env.VITEST &&
        checker({
          typescript: true,
          enableBuild: true,
        }),
    ].filter(Boolean),
    test: {
      include: ['src/**/*.{test,spec}.{ts,mts,cts}'],
      exclude: [...configDefaults.exclude],
      watch: false,
      testTimeout: 10_000,
      passWithNoTests: true,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV),
    },
    resolve: {
      tsconfigPaths: true,
      alias: {
        '@extension': resolve(__dirname, './src'),
        '@webview': resolve(__dirname, './src/webview'),
      },
    },
  };
});
