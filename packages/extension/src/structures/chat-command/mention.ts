import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { formatPathRelativeToCwdOrAbsolute } from '@earendil-works/pi-coding-agent';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { resolveCommitTag } from '@pi-code/extension/structures/chat-command/helpers/git';
import { checkReadableFile, normalizeSeparators, walkDirectory } from '@pi-code/extension/utilities/fs';
import { readNumberedText } from '@pi-code/extension/utilities/truncate';
import { MENTION_PATTERN, TAG_PATTERN } from '@pi-code/shared/core/constants';
import { buildFileTree, renderFileTree } from '@pi-code/shared/utilities/tree';

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
  const mentions = [...text.matchAll(MENTION_PATTERN)];
  const tags = [...text.matchAll(TAG_PATTERN)];
  if (mentions.length === 0 && tags.length === 0) return { text, mentionContent: '' };

  const limits = readOutputLimits();
  const [mentionBlocks, commitBlocks] = await Promise.all([collectMentionBlocks(mentions, cwd, limits), collectCommitBlocks(tags, cwd, limits)]);
  return { text, mentionContent: [...mentionBlocks, ...commitBlocks].join('\n\n') };
}

async function collectMentionBlocks(matches: RegExpMatchArray[], cwd: string, limits: OutputLimits): Promise<string[]> {
  if (matches.length === 0) return [];

  const resolved = new Map<string, ResolvedMention | null>();
  const uniqueMentions = [...new Set(matches.map((match) => match[1]))];
  const resolvedMentions = await Promise.all(uniqueMentions.map((raw) => resolveMention(raw, cwd, limits)));
  uniqueMentions.forEach((raw, index) => resolved.set(raw, resolvedMentions[index]));

  return [...resolved.entries()]
    .filter((entry): entry is [string, ResolvedMention] => entry[1] !== null)
    .map(([path, mention]) =>
      mention.kind === 'folder'
        ? [`## Folder Content: ${path}`, '', mention.content].join('\n')
        : [`## File Content: ${path}`, '', mention.content].join('\n'),
    );
}

async function collectCommitBlocks(tags: RegExpMatchArray[], cwd: string, limits: OutputLimits): Promise<string[]> {
  const uniqueTags = [...new Set(tags.map((match) => match[1]))];
  const blocks = await Promise.all(uniqueTags.map((token) => resolveCommitTag(token, cwd, limits)));
  return blocks.filter((block): block is string => block !== null);
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
  const paths: string[] = [];
  let entryCount = 0;
  let totalChars = 0;
  let truncated = false;

  for await (const { abs } of walkDirectory(dir, FOLDER_MAX_DEPTH)) {
    if (entryCount >= FOLDER_MAX_FILES) {
      truncated = true;
      break;
    }

    const rel = normalizeSeparators(relative(dir, abs));
    if (totalChars + rel.length > FOLDER_CHAR_CAP) {
      truncated = true;
      break;
    }

    paths.push(rel);
    totalChars += rel.length;
    entryCount++;
  }

  const rootLabel = formatPathRelativeToCwdOrAbsolute(dir, cwd);
  const tree = renderFileTree(buildFileTree(paths), rootLabel);
  return truncated ? `${tree}\n\n... folder truncated: ${entryCount} entries listed ...` : tree;
}
