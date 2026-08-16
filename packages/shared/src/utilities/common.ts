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

export function safeJsonParse<T>(value?: string): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function serializeToolArgs(args: unknown): string {
  return typeof args === 'string' ? args : JSON.stringify(args ?? {});
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
