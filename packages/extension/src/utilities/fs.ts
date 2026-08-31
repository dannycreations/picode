import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

import { logger } from '@pi-code/shared/core/logger';
import { pathCollator } from '@pi-code/shared/utilities/common';

export interface FileChild {
  readonly name: string;
  readonly isDir: boolean;
  readonly isFile: boolean;
  readonly isSymlink: boolean;
}

export function excludeVcsEntries(children: FileChild[]): FileChild[] {
  return children.filter((child) => child.name !== '.git');
}

async function readNodeChildren(dir: string): Promise<FileChild[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  return dirents.map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink() }));
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
  const walk = async function* (dir: string, depth: number): AsyncGenerator<DirectoryEntry> {
    if (depth > maxDepth) return;

    let children: FileChild[];
    try {
      children = await readNodeChildren(dir);
    } catch (err) {
      logger.debug(`Skipping unreadable directory ${dir}:`, err);
      return;
    }
    children = excludeVcsEntries(children);

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
    return pathCollator.compare(a, b);
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

  if (needle === '') {
    const entries: string[] = [];
    for await (const { rel, entry } of walkDirectory(start, 0, cwd)) {
      if (entry.isFile || entry.isDir) entries.push(rel);
    }
    return entries.sort((a, b) => pathCollator.compare(a, b)).slice(0, MAX_RESULTS);
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

const MEGABYTE = 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 10 * MEGABYTE;

export async function checkReadableFile(path: string): Promise<{ ok: true } | { ok: false; body: string }> {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      return { ok: false, body: `Error: "${path}" is not a regular file.` };
    }
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      return {
        ok: false,
        body: `Error: ${path} exceeds the ${MAX_FILE_SIZE_BYTES / MEGABYTE} MB size limit (${(fileStat.size / MEGABYTE).toFixed(2)} MB).`,
      };
    }
    if (await isBinaryFile(path)) {
      return { ok: false, body: `Error: ${path} is binary and cannot be read as text.` };
    }
    return { ok: true };
  } catch (err) {
    // A missing file is an expected, non-error outcome for callers that probe
    // existence, so report it as not-found instead of throwing.
    if (isEnoent(err)) {
      return { ok: false, body: `Error: "${path}" does not exist.` };
    }
    throw err;
  }
}

// Node reports missing paths with ENOENT; several callers treat that case as
// expected rather than as a failure.
export function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (isEnoent(err)) {
      return false;
    }
    throw err;
  }
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

export async function* streamLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      yield line;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function readLines(filePath: string, maxLines?: number): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of streamLines(filePath)) {
    lines.push(line);
    if (maxLines !== undefined && lines.length >= maxLines) {
      break;
    }
  }
  return lines;
}

export function numberLines(lines: readonly string[], ranges: readonly (readonly [number, number])[] | undefined): string {
  if (!ranges || ranges.length === 0) {
    return lines.map((line, index) => `${index + 1}|${line}`).join('\n');
  }

  const parts: string[] = [];

  // Separate genuinely invalid ranges (their message is preserved) from ranges
  // we can number, so the merge below never folds one into the other.
  const valid: Array<[number, number]> = [];
  for (const range of ranges) {
    const start = Math.max(1, range[0]);
    const end = Math.min(lines.length, range[1]);

    if (start > end) {
      parts.push(`Invalid range: ${start}-${end}`);
      continue;
    }

    valid.push([start, end]);
  }

  // Number each line once. Sort and merge overlapping or adjacent spans so a
  // caller that passes [1,5] and [3,8] yields lines 1-8 a single time instead
  // of repeating the shared lines and doing range-count times line-count work.
  valid.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [start, end] of valid) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  for (const [start, end] of merged) {
    for (let i = start; i <= end; i++) {
      parts.push(`${i}|${lines[i - 1]}`);
    }
  }
  return parts.join('\n');
}

export async function isBinaryFile(filePath: string, sampleBytes = 4096): Promise<boolean> {
  const buffer = Buffer.alloc(sampleBytes);
  const handle = await open(filePath, 'r');
  try {
    const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
