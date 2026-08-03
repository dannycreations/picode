import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, promises, rmSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = join(rootDir, 'dist');
const binDir = join(rootDir, 'bin');

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

async function main(): Promise<void> {
  console.log('Starting build with Vite...');

  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }
  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true });
  }
  mkdirSync(binDir, { recursive: true });

  console.log('Bundling extension backend...');
  await build({
    configFile: false,
    build: {
      lib: {
        entry: resolve(rootDir, 'src', 'index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      outDir: distDir,
      emptyOutDir: false,
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
      conditions: ['node', 'import', 'require'],
      alias: {
        '@extension': resolve(rootDir, 'src'),
        '@webview': resolve(rootDir, 'src/webview'),
      },
    },
    define: {
      'import.meta': '{}',
      'import.meta.url': '__importMetaUrl',
    },
  });

  console.log('Bundling webview frontend...');
  await build({
    configFile: false,
    plugins: [react()],
    build: {
      lib: {
        entry: resolve(rootDir, 'src', 'webview', 'index.tsx'),
        formats: ['iife'],
        name: 'webview',
        fileName: () => 'webview.cjs',
      },
      outDir: distDir,
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      target: 'chrome120',
      rolldownOptions: {
        external: [],
        output: {
          exports: 'none',
        },
      },
    },
    resolve: {
      alias: {
        '@extension': resolve(rootDir, 'src'),
        '@webview': resolve(rootDir, 'src/webview'),
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log('Building Tailwind CSS...');
  execSync('npx @tailwindcss/cli -i src/webview/index.css -o dist/webview.css --minify', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('Copying Codicons CSS...');
  const codiconsSrcDir = dirname(require.resolve('@vscode/codicons/dist/codicon.css'));
  await promises.copyFile(join(codiconsSrcDir, 'codicon.css'), join(distDir, 'codicon.css'));
  await promises.copyFile(join(codiconsSrcDir, 'codicon.ttf'), join(distDir, 'codicon.ttf'));

  console.log('Packaging with vsce...');
  execSync('npx vsce package --no-dependencies --readme-path README.md --skip-license --allow-missing-repository -o bin/', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('Build and packaging complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
