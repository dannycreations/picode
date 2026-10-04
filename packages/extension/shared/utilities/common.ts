import { findFencedBlock } from '@pi-code/shared/utilities/markdown';

import type { ActiveTaskState, AssistantChatMessage, ChatMessage, ModelThinkingLevel, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export const BYTES_PER_KILOBYTE = 1024;

// Sorts names with numeric segments in natural order (file2 before file10).
export const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Windows paths are compared and matched with forward slashes everywhere, so
// the separator is normalized once at every entry point.
export function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

// Escapes regex metacharacters so a literal needle can be used in a RegExp.
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTextAttachment(content: unknown): TextAttachment | null {
  if (typeof content !== 'string') return null;

  const block = findFencedBlock(content.trim(), true);
  if (!block?.terminated) return null;

  return block.language ? { kind: 'text', content: block.content, language: block.language } : { kind: 'text', content: block.content };
}

const EMPTY_STATS: StatsData = {
  tokensIn: 0,
  tokensOut: 0,
  cacheWrites: 0,
  cacheReads: 0,
  totalCost: 0,
  contextTokens: 0,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
};

export function createActiveTask(id: string, title: string, messages: ChatMessage[]): ActiveTaskState {
  return { id, title, messages, ...EMPTY_STATS };
}

export function hasVisibleOutput(message: AssistantChatMessage): boolean {
  return message.text.trim() !== '' || (message.reasoning?.trim() ?? '') !== '';
}

export function findReplaceableFailedRequest(messages: readonly ChatMessage[]): number | undefined {
  let chainStart: number | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.sender === 'assistant' && !hasVisibleOutput(message)) continue;
    if (message.sender === 'api_request' && message.toolStatus === 'denied') {
      chainStart = index;
      continue;
    }
    break;
  }
  return chainStart;
}

export function defaultThinkingLevel(levels: readonly ModelThinkingLevel[]): ModelThinkingLevel | null {
  if (levels.length === 0) return null;
  if (levels.includes('medium')) return 'medium';
  return levels.find((level) => level !== 'off') ?? levels[0];
}

// Models that do not report a context window share the EMPTY_STATS budget, so
// every consumer resolves the effective limit through one function.
export function resolveContextLimit(contextWindow: number | undefined): number {
  return contextWindow ?? EMPTY_STATS.contextLimit;
}

export function findOccurrences(haystack: string, needle: string, caseSensitive = false): number[] {
  if (needle === '') return [];

  const positions: number[] = [];
  for (const match of haystack.matchAll(new RegExp(escapeRegExp(needle), caseSensitive ? 'g' : 'gi'))) {
    positions.push(match.index);
  }
  return positions;
}

export interface OccurrenceSegment {
  readonly text: string;
  // Match ordinal when this segment is a needle occurrence; null for the text
  // between occurrences.
  readonly matchIndex: number | null;
}

// Splits text into plain and matched segments in order, so renderers can wrap
// matches without repeating the position bookkeeping themselves.
export function splitOnOccurrences(text: string, needle: string, caseSensitive = false): OccurrenceSegment[] {
  const positions = findOccurrences(text, needle, caseSensitive);
  if (positions.length === 0) return [{ text, matchIndex: null }];

  const segments: OccurrenceSegment[] = [];
  let cursor = 0;
  positions.forEach((position, matchIndex) => {
    if (position > cursor) {
      segments.push({ text: text.slice(cursor, position), matchIndex: null });
    }
    segments.push({ text: text.slice(position, position + needle.length), matchIndex });
    cursor = position + needle.length;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matchIndex: null });
  }
  return segments;
}

export function elapsedSeconds(start: number, end: number = Date.now()): number {
  return Math.max(0, Math.round((end - start) / 1000));
}

export function relativeToWorkspace(path: string, root: string): string {
  if (!root) return path;

  const normPath = normalizeSeparators(path);
  const normRoot = normalizeSeparators(root).replace(/\/+$/, '');
  if (normRoot === '') return path;

  const caseInsensitive = /^[a-zA-Z]:\//.test(normRoot);
  const rootWithSlash = `${normRoot}/`;
  const inside = caseInsensitive ? normPath.toLowerCase().startsWith(rootWithSlash.toLowerCase()) : normPath.startsWith(rootWithSlash);

  return inside ? normPath.slice(rootWithSlash.length) : path;
}
