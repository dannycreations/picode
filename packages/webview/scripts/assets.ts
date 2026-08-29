import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { require, resolveBin } from '../../extension/scripts/build.ts';

const packageDir = resolve(import.meta.dirname, '..');
const distDir = join(packageDir, 'dist');

const CODICON_FILES = ['codicon.css', 'codicon.ttf'] as const;

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
