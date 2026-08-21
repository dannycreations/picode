import type { ActiveTaskState, ChatMessage, ModelThinkingLevel, StatsData } from '@pi-code/shared/core/types';

export const EMPTY_STATS: StatsData = {
  tokensIn: 0,
  tokensOut: 0,
  cacheWrites: 0,
  cacheReads: 0,
  totalCost: 0,
  contextTokens: 0,
  contextLimit: 200_000,
};

export function createActiveTask(id: string, title: string, messages: ChatMessage[]): ActiveTaskState {
  return { id, title, messages, ...EMPTY_STATS };
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
  const source = caseSensitive ? haystack : haystack.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();
  const positions: number[] = [];
  let from = 0;
  let index = source.indexOf(target, from);
  while (index !== -1) {
    positions.push(index);
    from = index + target.length;
    index = source.indexOf(target, from);
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
