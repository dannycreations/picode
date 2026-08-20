import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

export interface FileChild {
  readonly name: string;
  readonly isDir: boolean;
  readonly isFile: boolean;
  readonly isSymlink: boolean;
}

export async function readDirectoryChildren(dir: string, readRaw: (dir: string) => Promise<FileChild[]>): Promise<FileChild[]> {
  let children: FileChild[];
  try {
    children = await readRaw(dir);
  } catch {
    return [];
  }
  return children.filter((child) => child.name !== '.git');
}

interface DirectoryEntry {
  readonly abs: string;
  readonly rel: string;
  readonly entry: FileChild;
}

export function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

export async function* walkDirectory(start: string, maxDepth: number, root: string = start): AsyncGenerator<DirectoryEntry> {
  const readRaw = async (dir: string): Promise<FileChild[]> => {
    const dirents = await readdir(dir, { withFileTypes: true });
    return dirents.map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink() }));
  };

  const walk = async function* (dir: string, depth: number): AsyncGenerator<DirectoryEntry> {
    if (depth > maxDepth) return;

    const children = await readDirectoryChildren(dir, readRaw);
    for (const child of children) {
      const abs = resolve(dir, child.name);
      yield { abs, rel: formatPathRelativeToCwdOrAbsolute(abs, root), entry: child };
      if (child.isDir && depth < maxDepth && !child.isSymlink) {
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
  readonly pathLength: number;
}

function rankPath(path: string, needle: string): PathRank {
  const segments = path.split('/');
  const base = segments.pop() ?? path;
  const baseIndex = base.toLowerCase().indexOf(needle);
  return {
    prefix: baseIndex === 0 ? 0 : 1,
    baseIndex: baseIndex < 0 ? Number.MAX_SAFE_INTEGER : baseIndex,
    depth: segments.length,
    pathLength: path.length,
  };
}

function rankPaths(paths: readonly string[], needle: string): string[] {
  return [...paths].sort((a, b) => {
    const ra = rankPath(a, needle);
    const rb = rankPath(b, needle);
    if (ra.prefix !== rb.prefix) return ra.prefix - rb.prefix;
    if (ra.baseIndex !== rb.baseIndex) return ra.baseIndex - rb.baseIndex;
    if (ra.depth !== rb.depth) return ra.depth - rb.depth;
    if (ra.pathLength !== rb.pathLength) return ra.pathLength - rb.pathLength;
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
    for await (const { rel, entry } of walkDirectory(start, 0, cwd)) {
      if (entry.isFile || entry.isDir) entries.push(rel);
    }
    return entries.slice(0, MAX_RESULTS);
  }

  const matches: string[] = [];
  let scanned = 0;

  for await (const { rel, entry } of walkDirectory(start, SEARCH_MAX_DEPTH, cwd)) {
    scanned++;
    if (scanned > MAX_SCANNED) break;
    if (!entry.isFile && !entry.isDir) continue;
    if (!rel.toLowerCase().includes(needle)) continue;
    matches.push(rel);
  }

  return rankPaths(matches, needle).slice(0, MAX_RESULTS);
}
