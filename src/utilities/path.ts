import { isAbsolute, relative, resolve } from 'node:path';

export function resolveWorkspacePath(cwd: string, filePath: string): string {
  const resolvedPath = resolve(cwd, filePath);
  const relativePath = relative(cwd, resolvedPath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Cannot access paths outside the workspace.');
  }

  return resolvedPath;
}

export function resolvePathAction(
  filePath: string,
  autoApproveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): 'approve' | 'confirm' | 'deny' {
  if (!autoApproveEnabled) {
    return 'confirm';
  }

  const matchingAllowed = allowedPatterns.filter((pat) => matchesGlob(pat, filePath));
  const matchingDenied = deniedPatterns.filter((pat) => matchesGlob(pat, filePath));

  if (matchingAllowed.length > 0 && matchingDenied.length > 0) {
    const longestAllowed = matchingAllowed.reduce((a, b) => (a.length >= b.length ? a : b), '');
    const longestDenied = matchingDenied.reduce((a, b) => (a.length >= b.length ? a : b), '');

    if (longestDenied.length >= longestAllowed.length) {
      return 'deny';
    } else {
      return 'approve';
    }
  }

  if (matchingDenied.length > 0) {
    return 'deny';
  }

  if (matchingAllowed.length > 0) {
    return 'approve';
  }

  if (allowedPatterns.length === 0) {
    return 'approve';
  }

  return 'confirm';
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  const f = filePath.replace(/\\/g, '/');

  let regStr = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        regStr += '.*';
        i++;
        if (p[i + 1] === '/') {
          i++;
        }
      } else {
        regStr += '[^/]*';
      }
    } else if (c === '?') {
      regStr += '[^/]';
    } else if (['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'].includes(c)) {
      regStr += '\\' + c;
    } else {
      regStr += c;
    }
  }

  const regex = new RegExp(`^${regStr}$`, 'i');
  return regex.test(f);
}
