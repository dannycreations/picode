import { COMMIT_HASH_PATTERN, MENTION_PATTERN, TAG_PATTERN, WORKING_CHANGES_TAG } from '@pi-code/shared/core/constants';
import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';

import type { CommandItem } from '@pi-code/shared/core/protocol';

interface TokenSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

// The extension resolves only these tags into commit content; every other
// #word loads nothing and must not claim to.
function isResolvableTag(token: string): boolean {
  return token === WORKING_CHANGES_TAG || COMMIT_HASH_PATTERN.test(token);
}

interface TokenPattern {
  readonly pattern: RegExp;
  readonly accepts: (token: string) => boolean;
}

const TOKEN_PATTERNS: readonly TokenPattern[] = [
  { pattern: MENTION_PATTERN, accepts: () => true },
  { pattern: TAG_PATTERN, accepts: isResolvableTag },
];

export function splitTokenSegments(text: string, commands: readonly CommandItem[]): readonly TokenSegment[] {
  const command = splitCommand(text, commands);
  if (command) {
    return [{ text: command.command, highlighted: true }, ...splitTokens(command.rest)];
  }
  return splitTokens(text);
}

function splitTokens(text: string): readonly TokenSegment[] {
  if (text.length === 0) return [];

  let segments: TokenSegment[] = [{ text, highlighted: false }];
  for (const { pattern, accepts } of TOKEN_PATTERNS) {
    segments = segments.flatMap((segment) => (segment.highlighted ? [segment] : splitOnPattern(segment.text, pattern, accepts)));
  }
  return segments;
}

function splitOnPattern(text: string, pattern: RegExp, accepts: (token: string) => boolean): TokenSegment[] {
  const segments: TokenSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!accepts(match[1])) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
