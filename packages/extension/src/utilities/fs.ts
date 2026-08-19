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

interface PathRank {
  // Basename starts with the query: 0. Match elsewhere in the basename: 1.
  readonly prefix: number;
  // Index of the query within the basename. Lower is a closer match.
  readonly baseIndex: number;
  // Path depth, counted as directory separators. Shallower is closer.
  readonly depth: number;
  // Full path length, used as a final closeness tiebreaker.
  readonly length: number;
}

function rankPath(path: string, needle: string): PathRank {
  const base = path.split('/').pop() ?? path;
  const baseIndex = base.toLowerCase().indexOf(needle);
  return {
    prefix: baseIndex === 0 ? 0 : 1,
    baseIndex: baseIndex < 0 ? Number.MAX_SAFE_INTEGER : baseIndex,
    depth: path.split('/').length - 1,
    length: path.length,
  };
}

function rankPaths(paths: readonly string[], needle: string): string[] {
  return [...paths].sort((a, b) => {
    const ra = rankPath(a, needle);
    const rb = rankPath(b, needle);
    if (ra.prefix !== rb.prefix) return ra.prefix - rb.prefix;
    if (ra.baseIndex !== rb.baseIndex) return ra.baseIndex - rb.baseIndex;
    if (ra.depth !== rb.depth) return ra.depth - rb.depth;
    if (ra.length !== rb.length) return ra.length - rb.length;
    return a.localeCompare(b);
  });
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

  const matches: string[] = [];
  let scanned = 0;

  for await (const { rel, dirent } of walkDirectory(start, SEARCH_MAX_DEPTH, cwd)) {
    scanned++;
    if (scanned > MAX_SCANNED) break;
    if (!dirent.isFile() && !dirent.isDirectory()) continue;
    if (!rel.toLowerCase().includes(needle)) continue;
    matches.push(rel);
  }

  return rankPaths(matches, needle).slice(0, MAX_RESULTS);
}
