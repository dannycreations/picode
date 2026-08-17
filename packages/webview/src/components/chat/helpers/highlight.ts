import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';

import type { CommandItem } from '@pi-code/shared/core/protocol';

const MENTION_PATTERN = /(?<=^|\s)@(\S+)/g;

interface InputSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

export function splitInputSegments(text: string, commands: readonly CommandItem[]): readonly InputSegment[] {
  const command = splitCommand(text, commands);
  const segments: InputSegment[] = [];

  if (command) {
    segments.push({ text: command.command, highlighted: true });
    pushMentionSegments(segments, command.rest);
  } else {
    pushMentionSegments(segments, text);
  }

  return segments;
}

function pushMentionSegments(segments: InputSegment[], text: string): void {
  let cursor = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
}
