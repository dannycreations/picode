import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const distDir = join(packageDir, 'dist');
const webviewDistDir = resolve(packageDir, '..', 'webview', 'dist');

// The webview package owns its own bundle, stylesheet and icon font. The extension
// only ships them, so they are copied next to the extension bundle after each build.
export function copyWebviewAssets(): void {
  if (!existsSync(webviewDistDir)) {
    throw new Error(`Missing webview build output at "${webviewDistDir}". Run "pnpm --filter @pi-code/webview build" first.`);
  }

  mkdirSync(distDir, { recursive: true });
  cpSync(webviewDistDir, distDir, { recursive: true });
}
