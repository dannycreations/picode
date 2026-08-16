const MENTION_PATTERN = /(?<=^|\s)@([^\s]*)$/;

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

  if (!match) {
    const inserted = `@${path} `;
    return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
  }

  const at = match.index;
  const newBefore = `${before.slice(0, at)}@${path} `;
  return { text: `${newBefore}${after}`, caret: newBefore.length };
}
