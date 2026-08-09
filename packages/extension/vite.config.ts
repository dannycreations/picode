import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import { copyWebviewAssets } from './scripts/assets.ts';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

const srcDir = resolve(import.meta.dirname, 'src');

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [
      isBuild && {
        name: 'pi-code:webview-assets',
        closeBundle: copyWebviewAssets,
      },
    ],
    build: {
      lib: {
        entry: resolve(srcDir, 'index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      outDir: 'dist',
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      target: 'node24.13.3',
      rolldownOptions: {
        external: ['vscode', ...nodeBuiltins],
        output: {
          banner: "const __importMetaUrl = typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : undefined;",
          exports: 'named',
          codeSplitting: false,
        },
      },
    },
    resolve: {
      // Only narrow the resolver for the bundle. Vitest keeps the default
      // conditions so test files resolve the same way the source does.
      ...(isBuild ? { conditions: ['node', 'import', 'require'] } : {}),
      alias: {
        '@pi-code/extension': srcDir,
      },
    },
    define: isBuild ? { 'import.meta': '{}', 'import.meta.url': '__importMetaUrl' } : {},
    test: {
      include: ['src/**/*.{test,spec}.{ts,mts,cts}'],
      watch: false,
      testTimeout: 10_000,
      passWithNoTests: true,
      alias: {
        vscode: resolve(srcDir, 'test/vscode-stub.ts'),
      },
    },
  };
});
