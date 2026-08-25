import { WORKING_CHANGES_TAG } from '@pi-code/shared/core/constants';

import type { CommitItem } from '@pi-code/shared/core/protocol';

const MENTION_TOKEN_PATTERN = /(?<=^|\s)@([^\s]*)$/;
const TAG_TOKEN_PATTERN = /(?<=^|\s)#([^\s]*)$/;

interface MentionQuery {
  readonly query: string;
}

function readTokenQuery(pattern: RegExp, text: string, caret: number): MentionQuery | null {
  const match = pattern.exec(text.slice(0, caret));
  if (!match) return null;
  return { query: match[1] };
}

export function readMentionQuery(text: string, caret: number): MentionQuery | null {
  return readTokenQuery(MENTION_TOKEN_PATTERN, text, caret);
}

export function readTagQuery(text: string, caret: number): MentionQuery | null {
  return readTokenQuery(TAG_TOKEN_PATTERN, text, caret);
}

interface MentionInsertion {
  readonly text: string;
  readonly caret: number;
}

function insertToken(pattern: RegExp, prefix: string, text: string, caret: number, value: string): MentionInsertion {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const match = pattern.exec(before);
  if (!match) return { text, caret };

  const at = match.index;
  const newBefore = `${before.slice(0, at)}${prefix}${value} `;
  return { text: `${newBefore}${after}`, caret: newBefore.length };
}

export function applyMention(text: string, caret: number, path: string): MentionInsertion {
  return insertToken(MENTION_TOKEN_PATTERN, '@', text, caret, path);
}

export function applyTag(text: string, caret: number, value: string): MentionInsertion {
  return insertToken(TAG_TOKEN_PATTERN, '#', text, caret, value);
}

export interface CommitTagItem {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export const WORKING_CHANGES_ITEM: CommitTagItem = {
  value: WORKING_CHANGES_TAG,
  label: 'Working changes',
  description: 'Current uncommitted changes',
};

export function toCommitTagItem(commit: CommitItem): CommitTagItem {
  const detail = [commit.shortHash, commit.author && `by ${commit.author}`, commit.date && `on ${commit.date}`]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return { value: commit.shortHash, label: commit.subject, description: detail };
}
