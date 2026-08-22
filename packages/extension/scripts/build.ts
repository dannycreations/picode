import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';

export const require = createRequire(import.meta.url);

export function resolveBin(packageName: string, binName: string): string {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = require(manifestPath) as { bin?: string | Record<string, string> };
  const binPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!binPath) {
    throw new Error(`Unable to resolve the "${binName}" binary from "${packageName}".`);
  }
  return join(dirname(manifestPath), binPath);
}

if (resolve(argv[1] ?? '') === resolve(import.meta.filename)) {
  const packageDir = resolve(import.meta.dirname, '..');
  const workspaceDir = resolve(packageDir, '..', '..');
  const bundlePath = join(packageDir, 'dist', 'index.cjs');
  const outDir = join(workspaceDir, 'bin');

  if (!existsSync(bundlePath)) {
    throw new Error(`Missing extension bundle at "${bundlePath}". Run "pnpm --filter pi-code build" first.`);
  }

  // vsce packages the current directory, so the workspace license is mirrored
  // into this package to keep it inside the generated VSIX.
  copyFileSync(join(workspaceDir, 'LICENSE'), join(packageDir, 'LICENSE'));
  mkdirSync(outDir, { recursive: true });

  execFileSync(
    process.execPath,
    [
      resolveBin('@vscode/vsce', 'vsce'),
      'package',
      '--no-dependencies',
      '--readme-path',
      'README.md',
      '--skip-license',
      '--allow-missing-repository',
      '--out',
      outDir,
    ],
    { cwd: packageDir, stdio: 'inherit' },
  );
}
