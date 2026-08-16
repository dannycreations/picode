import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import { copyWebviewAssets } from './scripts/assets.ts';

import type { Plugin } from 'vitest/config';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];
const srcDir = resolve(import.meta.dirname, 'src');

const importMetaCjsShim = (): Plugin => ({
  name: 'pi-code:import-meta-cjs-shim',
  transform(code, id) {
    if (!id.includes('node_modules')) return;
    if (!code.includes('import.meta')) return;

    const transformed = code
      // import.meta.url
      .replace(/\bimport\.meta\.url\b/g, '__importMetaUrl')
      // import.meta.dirname
      .replace(/\bimport\.meta\.dirname\b/g, '__importMetaDirname')
      // import.meta.resolve(...)
      .replace(/\bimport\.meta\.resolve\b/g, '__importMetaResolve');
    if (transformed === code) return;
    return { code: transformed, map: null };
  },
});

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    plugins: [
      isBuild && importMetaCjsShim(),
      isBuild && {
        name: 'pi-code:webview-assets',
        closeBundle: copyWebviewAssets,
      },
    ].filter(Boolean),
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
          exports: 'named',
          codeSplitting: false,
          banner: `
const __importMetaUrl =
  require('node:url')
    .pathToFileURL(__filename)
    .href
    .replace(/\\.[^./\\\\]+$/, '.ts');

const __importMetaDirname = __dirname;

const __importMetaResolve = (specifier, parentUrl) =>
  require('node:url').pathToFileURL(
    require('node:module')
      .createRequire(parentUrl ?? __importMetaUrl)
      .resolve(specifier)
  ).href;`.trim(),
        },
      },
    },
    resolve: {
      ...(isBuild ? { conditions: ['node', 'import', 'require'] } : {}),
      alias: {
        '@pi-code/extension': srcDir,
        '@pi-code/shared': resolve(srcDir, 'shared'),
      },
    },
    test: {
      include: ['src/**/*.{test,spec}.{ts,mts,cts}'],
      watch: false,
      testTimeout: 10_000,
      passWithNoTests: true,
      alias: {
        vscode: 'data:text/javascript,export const window={};',
      },
    },
  };
});
