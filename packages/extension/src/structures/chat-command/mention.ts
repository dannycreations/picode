import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { MAX_FILE_SIZE_BYTES, MEGABYTE, numberLines, readLines } from '@pi-code/extension/structures/tool-call/read-file';
import { isBinaryFile } from '@pi-code/extension/utilities/codec';
import { toPosixPath, walkDirectory } from '@pi-code/extension/utilities/fs';
import { toOutputLimits, truncateOutput } from '@pi-code/extension/utilities/truncate';

import type { OutputLimits } from '@pi-code/extension/utilities/truncate';

const MENTION_PATTERN = /(?:^|(?<=[\s]))@(\S+)/g;

const FOLDER_MAX_FILES = 50;
const FOLDER_MAX_DEPTH = 2;
const FOLDER_CHAR_CAP = 20_000;

interface ResolvedMention {
  readonly kind: 'file' | 'folder';
  readonly content: string;
}

export async function expandMentions(text: string, cwd: string): Promise<string> {
  const matches = [...text.matchAll(MENTION_PATTERN)];
  if (matches.length === 0) return text;

  const limits = toOutputLimits(readAppSettings());

  const resolved = new Map<string, ResolvedMention | null>();
  for (const match of matches) {
    const raw = match[1];
    if (!resolved.has(raw)) {
      resolved.set(raw, await resolveMention(raw, cwd, limits));
    }
  }

  let rewritten = '';
  let cursor = 0;
  for (const match of matches) {
    const raw = match[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;

    rewritten += text.slice(cursor, start);
    const mention = resolved.get(raw);
    rewritten += mention ? `${raw} (${mention.kind} content below)` : match[0];
    cursor = end;
  }
  rewritten += text.slice(cursor);

  const blocks = [...resolved.entries()]
    .filter((entry): entry is [string, ResolvedMention] => entry[1] !== null)
    .map(([raw, mention]) =>
      mention.kind === 'folder'
        ? `<folder_content path="${raw}">\n${mention.content}\n</folder_content>`
        : `<file_content path="${raw}">\n${mention.content}\n</file_content>`,
    );

  if (blocks.length === 0) return text;
  return `${rewritten}\n\n${blocks.join('\n\n')}`;
}

async function resolveMention(raw: string, cwd: string, limits: OutputLimits): Promise<ResolvedMention | null> {
  const target = resolve(cwd, raw);

  let info;
  try {
    info = await stat(target);
  } catch {
    return null;
  }

  if (info.isDirectory()) {
    return { kind: 'folder', content: await readFolderContent(target, cwd, limits) };
  }
  if (info.isFile()) {
    try {
      return { kind: 'file', content: await readFileText(target, limits) };
    } catch (err) {
      return { kind: 'file', content: `Error reading file: ${formatThrownValue(err)}` };
    }
  }
  return null;
}

async function readFileText(resolvedPath: string, limits: OutputLimits): Promise<string> {
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) throw new Error(`"${resolvedPath}" is not a regular file`);
  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`exceeds the 10 MB size limit (${(fileStat.size / MEGABYTE).toFixed(2)} MB)`);
  }
  if (await isBinaryFile(resolvedPath)) throw new Error(`is binary and cannot be read as text`);

  const lines = await readLines(resolvedPath);
  const { text } = truncateOutput(numberLines(lines, undefined), { limits, keep: 'head' });
  return text;
}

async function readFolderContent(dir: string, cwd: string, limits: OutputLimits): Promise<string> {
  const blocks: string[] = [];
  let fileCount = 0;
  let totalChars = 0;

  for await (const { abs, dirent } of walkDirectory(dir, FOLDER_MAX_DEPTH)) {
    if (fileCount >= FOLDER_MAX_FILES) break;
    if (!dirent.isFile()) continue;

    try {
      const body = await readFileText(abs, limits);
      const block = `<file path="${toPosixPath(abs, cwd)}">\n${body}\n</file>`;
      if (totalChars + block.length > FOLDER_CHAR_CAP) {
        blocks.push(`... folder truncated: ${fileCount} files included ...`);
        break;
      }
      blocks.push(block);
      totalChars += block.length;
      fileCount++;
    } catch {}
  }

  return blocks.join('\n\n');
}
