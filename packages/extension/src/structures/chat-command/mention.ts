import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { checkReadableFile, walkDirectory } from '@pi-code/extension/utilities/fs';
import { readNumberedText } from '@pi-code/extension/utilities/truncate';
import { MENTION_PATTERN } from '@pi-code/shared/core/constants';

import type { OutputLimits } from '@pi-code/extension/utilities/truncate';

// A dropped file arrives as an absolute path or a `file://` URI. Collapse it to
// the workspace-relative `@token` the mention parser expects, so a Shift-drag
// produces the same reference the `@` picker inserts.
export function toMentionText(path: string, cwd: string): string {
  return `@${formatPathRelativeToCwdOrAbsolute(path, cwd)}`;
}

const FOLDER_MAX_FILES = 50;
const FOLDER_MAX_DEPTH = 2;
const FOLDER_CHAR_CAP = 20_000;

async function readFileText(path: string, limits: OutputLimits): Promise<string> {
  const check = await checkReadableFile(path);
  if (!check.ok) {
    throw new Error(check.body);
  }

  return readNumberedText(path, limits);
}

interface ResolvedMention {
  readonly kind: 'file' | 'folder';
  readonly content: string;
}

interface ExpandedMentions {
  // The prompt with the original `@token` references left intact, ready to be
  // shown to the user and persisted as the user message.
  readonly text: string;
  // The file/folder contents the model should read, delivered separately as a
  // hidden custom message so it never lands in the displayed transcript.
  readonly mentionContent: string;
}

export async function expandMentions(text: string, cwd: string): Promise<ExpandedMentions> {
  const matches = [...text.matchAll(MENTION_PATTERN)];
  if (matches.length === 0) return { text, mentionContent: '' };

  const limits = readOutputLimits();

  const resolved = new Map<string, ResolvedMention | null>();
  const uniqueMentions = [...new Set(matches.map((match) => match[1]))];
  const resolvedMentions = await Promise.all(uniqueMentions.map((raw) => resolveMention(raw, cwd, limits)));
  uniqueMentions.forEach((raw, index) => resolved.set(raw, resolvedMentions[index]));

  const blocks = [...resolved.entries()]
    .filter((entry): entry is [string, ResolvedMention] => entry[1] !== null)
    .map(([path, mention]) =>
      mention.kind === 'folder'
        ? [`## Folder Content: ${path}`, '', mention.content].join('\n')
        : [`## File Content: ${path}`, '', mention.content].join('\n'),
    );
  const mentionContent = blocks.length === 0 ? '' : blocks.join('\n\n');
  return { text, mentionContent };
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
      return { kind: 'file', content: await readFileText(target, limits) };
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

  for await (const { abs } of walkDirectory(dir, FOLDER_MAX_DEPTH)) {
    if (entryCount >= FOLDER_MAX_FILES) break;

    const label = formatPathRelativeToCwdOrAbsolute(abs, cwd);
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
