import { findFencedBlock } from '@pi-code/shared/utilities/markdown';

import type { ActiveTaskState, AssistantChatMessage, ChatMessage, ModelThinkingLevel, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export const BYTES_PER_KILOBYTE = 1024;
export const DEFAULT_CONTEXT_LIMIT = 200_000;

export const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function normalizeSeparators(path: string): string {
  return path.includes('\\') ? path.replace(/\\/g, '/') : path;
}

export function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-z]:\//i.test(path);
}

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

export function hasVisibleText(text: string | undefined): boolean {
  return !!text && /\S/.test(text);
}

export function hasVisibleOutput(message: AssistantChatMessage): boolean {
  return hasVisibleText(message.text) || hasVisibleText(message.reasoning);
}

export function startsWithIgnoringLeadingWhitespace(text: string, prefix: string): boolean {
  return text.trimStart().startsWith(prefix);
}

export function findReplaceableFailedRequest(messages: readonly ChatMessage[]): number | undefined {
  let chainStart: number | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    // A queued reply waits at the bottom of the transcript and belongs to no
    // turn, so it does not end the chain of failed attempts.
    if (message.sender === 'queue') continue;
    if (message.sender === 'assistant' && !hasVisibleOutput(message)) continue;
    if (message.sender === 'api_request' && message.toolStatus === 'denied') {
      chainStart = index;
      continue;
    }
    break;
  }
  return chainStart;
}

export function resolveThinkingLevel(
  levels: readonly ModelThinkingLevel[],
  preferred: ModelThinkingLevel | null | undefined,
): ModelThinkingLevel | null {
  if (preferred && levels.includes(preferred)) return preferred;
  if (levels.length === 0) return null;
  if (levels.includes('medium')) return 'medium';
  return levels.find((level) => level !== 'off') ?? levels[0];
}

export function resolveContextLimit(contextWindow: number | undefined): number {
  return contextWindow ?? DEFAULT_CONTEXT_LIMIT;
}

const LITERAL_PATTERN_CACHE_LIMIT = 256;
const literalPatterns = new Map<string, RegExp>();

export function setBounded<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.size >= limit) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

function literalPattern(needle: string, flags: 'g' | 'gi' | 'i'): RegExp {
  const key = `${flags}:${needle}`;
  const cached = literalPatterns.get(key);
  if (cached) return cached;

  const pattern = new RegExp(escapeRegExp(needle), flags);
  setBounded(literalPatterns, key, pattern, LITERAL_PATTERN_CACHE_LIMIT);
  return pattern;
}

function scanOccurrences(haystack: string, needle: string, caseSensitive: boolean, visit: (index: number) => void): void {
  if (needle === '') return;

  const pattern = literalPattern(needle, caseSensitive ? 'g' : 'gi');
  // The shared pattern carries its own scan position, so it is rewound before
  // every scan. The needle is never empty, so every match advances.
  pattern.lastIndex = 0;

  let match = pattern.exec(haystack);
  while (match !== null) {
    visit(match.index);
    match = pattern.exec(haystack);
  }
}

export function findOccurrences(haystack: string, needle: string, caseSensitive = false): number[] {
  const positions: number[] = [];
  scanOccurrences(haystack, needle, caseSensitive, (index) => positions.push(index));
  return positions;
}

export function countOccurrences(haystack: string, needle: string, caseSensitive = false): number {
  let count = 0;
  scanOccurrences(haystack, needle, caseSensitive, () => {
    count++;
  });
  return count;
}

export function containsIgnoreCase(haystack: string, needle: string): boolean {
  if (needle === '') return true;

  return literalPattern(needle, 'i').test(haystack);
}

export interface OccurrenceSegment {
  readonly text: string;
  readonly matchIndex: number | null;
}

export function splitOnOccurrences(text: string, needle: string, caseSensitive = false): OccurrenceSegment[] {
  const positions = findOccurrences(text, needle, caseSensitive);
  if (positions.length === 0) return [{ text, matchIndex: null }];

  const segments: OccurrenceSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    if (position > cursor) {
      segments.push({ text: text.slice(cursor, position), matchIndex: null });
    }
    segments.push({ text: text.slice(position, position + needle.length), matchIndex: index });
    cursor = position + needle.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matchIndex: null });
  }
  return segments;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function elapsedSeconds(start: number, end: number = Date.now()): number {
  return Math.max(0, Math.round((end - start) / 1000));
}

export function remainingSeconds(deadline: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function startsWithFold(haystack: string, needle: string): boolean {
  return haystack.length >= needle.length && haystack.slice(0, needle.length).toLowerCase() === needle.toLowerCase();
}

export function relativeToWorkspace(path: string, root: string): string {
  const normPath = normalizeSeparators(path);
  const normRoot = normalizeSeparators(root).replace(/\/+$/, '');
  if (normRoot === '') return path;

  const caseInsensitive = isWindowsAbsolutePath(normRoot);
  const rootWithSlash = `${normRoot}/`;
  const inside = caseInsensitive ? startsWithFold(normPath, rootWithSlash) : normPath.startsWith(rootWithSlash);

  return inside ? normPath.slice(rootWithSlash.length) : path;
}
