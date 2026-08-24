import { WORKING_CHANGES_TAG } from '@pi-code/shared/core/constants';

import type { CommitItem } from '@pi-code/shared/core/protocol';

const MENTION_PATTERN = /(?<=^|\s)@([^\s]*)$/;
const TAG_PATTERN = /(?<=^|\s)#([^\s]*)$/;

interface MentionQuery {
  readonly query: string;
}

export function readMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = MENTION_PATTERN.exec(before);
  if (!match) return null;
  return { query: match[1] };
}

interface MentionInsertion {
  readonly text: string;
  readonly caret: number;
}

export function applyMention(text: string, caret: number, path: string): MentionInsertion {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const match = MENTION_PATTERN.exec(before);
  if (!match) return { text, caret };

  const at = match.index;
  const newBefore = `${before.slice(0, at)}@${path} `;
  return { text: `${newBefore}${after}`, caret: newBefore.length };
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

export function readTagQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = TAG_PATTERN.exec(before);
  if (!match) return null;
  return { query: match[1] };
}

export function applyTag(text: string, caret: number, value: string): MentionInsertion {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const match = TAG_PATTERN.exec(before);
  if (!match) return { text, caret };

  const at = match.index;
  const newBefore = `${before.slice(0, at)}#${value} `;
  return { text: `${newBefore}${after}`, caret: newBefore.length };
}
