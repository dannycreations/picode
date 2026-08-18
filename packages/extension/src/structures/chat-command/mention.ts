import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { readFileTextContent } from '@pi-code/extension/structures/tool-call/read-file';
import { toPosixPath, walkDirectory } from '@pi-code/extension/utilities/fs';
import { toOutputLimits } from '@pi-code/extension/utilities/truncate';

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
  const uniqueMentions = [...new Set(matches.map((match) => match[1]))];
  const resolvedMentions = await Promise.all(uniqueMentions.map((raw) => resolveMention(raw, cwd, limits)));
  uniqueMentions.forEach((raw, index) => resolved.set(raw, resolvedMentions[index]));

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
    return { kind: 'folder', content: await listFolderEntries(target, cwd) };
  }
  if (info.isFile()) {
    try {
      return { kind: 'file', content: await readFileTextContent(target, limits) };
    } catch (err) {
      return { kind: 'file', content: formatThrownValue(err) };
    }
  }
  return null;
}

async function listFolderEntries(dir: string, cwd: string): Promise<string> {
  const lines: string[] = [];
  let entryCount = 0;
  let totalChars = 0;

  for await (const { abs, dirent } of walkDirectory(dir, FOLDER_MAX_DEPTH)) {
    if (entryCount >= FOLDER_MAX_FILES) break;

    const label = dirent.isDirectory() ? `${toPosixPath(abs, cwd)}/` : toPosixPath(abs, cwd);
    if (totalChars + label.length > FOLDER_CHAR_CAP) {
      lines.push(`... folder truncated: ${entryCount} entries listed ...`);
      break;
    }

    lines.push(label);
    totalChars += label.length;
    entryCount++;
  }

  return lines.join('\n');
}
