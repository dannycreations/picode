import { MENTION_PATTERN, TAG_PATTERN } from '@pi-code/shared/core/constants';
import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';

import type { CommandItem } from '@pi-code/shared/core/protocol';

interface InputSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

const TOKEN_PATTERNS = [MENTION_PATTERN, TAG_PATTERN];

export function splitInputSegments(text: string, commands: readonly CommandItem[]): readonly InputSegment[] {
  const command = splitCommand(text, commands);
  if (command) {
    return [{ text: command.command, highlighted: true }, ...splitTokens(command.rest)];
  }
  return splitTokens(text);
}

function splitTokens(text: string): readonly InputSegment[] {
  if (text.length === 0) return [];

  let segments: InputSegment[] = [{ text, highlighted: false }];
  for (const pattern of TOKEN_PATTERNS) {
    segments = segments.flatMap((segment) => (segment.highlighted ? [segment] : splitOnPattern(segment.text, pattern)));
  }
  return segments;
}

function splitOnPattern(text: string, pattern: RegExp): InputSegment[] {
  const segments: InputSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
