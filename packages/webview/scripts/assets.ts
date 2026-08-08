import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const packageDir = resolve(import.meta.dirname, '..');
const distDir = join(packageDir, 'dist');

const CODICON_FILES = ['codicon.css', 'codicon.ttf'] as const;

function resolveBin(packageName: string, binName: string): string {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = require(manifestPath) as { bin?: string | Record<string, string> };
  const binPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!binPath) {
    throw new Error(`Unable to resolve the "${binName}" binary from "${packageName}".`);
  }
  return join(dirname(manifestPath), binPath);
}

// The Vite lib build only emits the script bundle, so the stylesheet and the icon
// font are produced here and land in the same `dist` folder the extension copies.
export function buildStaticAssets(): void {
  mkdirSync(distDir, { recursive: true });

  execFileSync(
    process.execPath,
    [resolveBin('@tailwindcss/cli', 'tailwindcss'), '--input', 'src/index.css', '--output', 'dist/webview.css', '--minify'],
    {
      cwd: packageDir,
      stdio: 'inherit',
    },
  );

  const codiconsDir = dirname(require.resolve('@vscode/codicons/dist/codicon.css'));
  for (const file of CODICON_FILES) {
    copyFileSync(join(codiconsDir, file), join(distDir, file));
  }
}
