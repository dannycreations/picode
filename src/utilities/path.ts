import { isAbsolute, relative, resolve } from 'node:path';

export function resolveWorkspacePath(cwd: string, filePath: string): string {
  const resolvedPath = resolve(cwd, filePath);
  const relativePath = relative(cwd, resolvedPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Cannot access paths outside the workspace.');
  }

  return resolvedPath;
}
