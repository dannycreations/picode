import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

import type { Dirent } from 'node:fs';

interface DirectoryEntry {
  readonly abs: string;
  readonly rel: string;
  readonly dirent: Dirent;
}

export function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

export async function* walkDirectory(start: string, maxDepth: number, root: string = start): AsyncGenerator<DirectoryEntry> {
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
      yield { abs, rel: formatPathRelativeToCwdOrAbsolute(abs, root), dirent };
      if (dirent.isDirectory() && depth < maxDepth) {
        yield* walk(abs, depth + 1);
      }
    }
  };

  yield* walk(start, 0);
}

const MAX_RESULTS = 50;
const MAX_SCANNED = 8000;
const SEARCH_MAX_DEPTH = 2;

export async function searchWorkspaceFiles(query: string, cwd: string): Promise<string[]> {
  const segments = query.split('/');
  const namePart = segments[segments.length - 1];
  const dirPart = segments.slice(0, -1).join('/');
  const needle = namePart.toLowerCase();
  const start = dirPart ? resolve(cwd, dirPart) : cwd;

  // With no name fragment, list the immediate children of the anchor directory.
  if (needle === '') {
    const entries: string[] = [];
    for await (const { rel, dirent } of walkDirectory(start, 0, cwd)) {
      if (dirent.isFile() || dirent.isDirectory()) entries.push(rel);
    }
    return entries.slice(0, MAX_RESULTS);
  }

  const results: string[] = [];
  let scanned = 0;
  let stopped = false;

  for await (const { rel, dirent } of walkDirectory(start, SEARCH_MAX_DEPTH, cwd)) {
    if (stopped || results.length >= MAX_RESULTS) break;
    scanned++;
    if (scanned > MAX_SCANNED) {
      stopped = true;
      break;
    }
    if (!dirent.isFile() && !dirent.isDirectory()) continue;
    if (!rel.toLowerCase().includes(needle)) continue;
    results.push(rel);
  }

  return results.slice(0, MAX_RESULTS);
}
