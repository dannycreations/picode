import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import type { Dirent } from 'node:fs';

interface DirectoryEntry {
  readonly abs: string;
  readonly rel: string;
  readonly dirent: Dirent;
}

export function toPosixPath(abs: string, cwd: string): string {
  return relative(cwd, abs).split('\\').join('/');
}

export async function* walkDirectory(cwd: string, maxDepth: number): AsyncGenerator<DirectoryEntry> {
  const walk = async function* (dir: string, depth: number): AsyncGenerator<DirectoryEntry> {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of entries) {
      const abs = resolve(dir, dirent.name);
      yield { abs, rel: toPosixPath(abs, cwd), dirent };
      if (dirent.isDirectory() && depth < maxDepth) {
        yield* walk(abs, depth + 1);
      }
    }
  };

  yield* walk(cwd, 0);
}

const MAX_RESULTS = 50;
const MAX_DEPTH = 8;
const MAX_SCANNED = 8000;

export async function searchWorkspaceFiles(query: string, cwd: string): Promise<string[]> {
  const needle = query.toLowerCase();

  // With no query, show the immediate children of the workspace root.
  if (needle === '') {
    try {
      const entries = await readdir(cwd, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => entry.name)
        .slice(0, MAX_RESULTS);
    } catch {
      return [];
    }
  }

  const results: string[] = [];
  let scanned = 0;
  let stopped = false;

  for await (const { rel, dirent } of walkDirectory(cwd, MAX_DEPTH)) {
    if (stopped || results.length >= MAX_RESULTS) break;
    scanned++;
    if (scanned > MAX_SCANNED) {
      stopped = true;
      break;
    }
    if (dirent.isFile() || dirent.isDirectory()) {
      if (rel.toLowerCase().includes(needle)) {
        results.push(rel);
      }
    }
  }

  return results.slice(0, MAX_RESULTS);
}
