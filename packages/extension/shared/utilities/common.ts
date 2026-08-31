import type { ActiveTaskState, AssistantChatMessage, ChatMessage, ModelThinkingLevel, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export const DEFAULT_CONTEXT_LIMIT = 200_000;

// Sorts names with numeric segments in natural order (file2 before file10).
export const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Wraps a text attachment as a fenced markdown block for the model prompt.
export function formatTextAttachment(attachment: TextAttachment): string {
  const language = attachment.language ? ` ${attachment.language}` : '';
  return `\`\`\`${language}\n${attachment.content}\n\`\`\``;
}

export function parseTextAttachment(content: unknown): TextAttachment | null {
  if (typeof content !== 'string') return null;

  const match = /^``` ?(\S*)\n([\s\S]*?)\n```$/.exec(content.trim());
  if (!match) return null;

  const language = match[1];
  return language ? { kind: 'text', content: match[2], language } : { kind: 'text', content: match[2] };
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

function hasVisibleOutput(message: AssistantChatMessage): boolean {
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
  if (caseSensitive) {
    const positions: number[] = [];
    let from = 0;
    let index = haystack.indexOf(needle, from);
    while (index !== -1) {
      positions.push(index);
      from = index + needle.length;
      index = haystack.indexOf(needle, from);
    }
    return positions;
  }

  const positions: number[] = [];
  const escapeNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of haystack.matchAll(new RegExp(escapeNeedle, 'gi'))) {
    if (match.index !== undefined) positions.push(match.index);
  }
  return positions;
}

interface OccurrenceSegment {
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

  const normPath = path.replace(/\\/g, '/');
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normRoot === '') return path;

  const caseInsensitive = /^[a-zA-Z]:\//.test(normRoot);
  const rootWithSlash = `${normRoot}/`;
  const inside = caseInsensitive ? normPath.toLowerCase().startsWith(rootWithSlash.toLowerCase()) : normPath.startsWith(rootWithSlash);

  return inside ? normPath.slice(rootWithSlash.length) : path;
}
