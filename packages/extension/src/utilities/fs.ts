import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

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
    } catch {
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
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, body: `Error: "${path}" does not exist.` };
    }
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
  for (const range of ranges) {
    const start = Math.max(1, range[0]);
    const end = Math.min(lines.length, range[1]);

    if (start > end) {
      parts.push(`Invalid range: ${start}-${end}`);
      continue;
    }

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
