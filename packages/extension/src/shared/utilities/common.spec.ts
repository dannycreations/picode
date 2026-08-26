import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTEXT_LIMIT, findReplaceableFailedRequest, resolveContextLimit, splitOnOccurrences } from './common';

import type { ChatMessage } from '../core/types';

describe('splitOnOccurrences', () => {
  it('returns one unmatched segment when nothing matches', () => {
    expect(splitOnOccurrences('abc', 'x')).toEqual([{ text: 'abc', matchIndex: null }]);
  });

  it('returns the whole text as a single match', () => {
    expect(splitOnOccurrences('@foo', '@foo')).toEqual([{ text: '@foo', matchIndex: 0 }]);
  });

  it('interleaves plain and matched segments with ordinals', () => {
    expect(splitOnOccurrences('a cat and a cat', 'cat')).toEqual([
      { text: 'a ', matchIndex: null },
      { text: 'cat', matchIndex: 0 },
      { text: ' and a ', matchIndex: null },
      { text: 'cat', matchIndex: 1 },
    ]);
  });

  it('matches case-insensitively by default but keeps the original casing', () => {
    expect(splitOnOccurrences('Foo bar FOO', 'foo')).toEqual([
      { text: 'Foo', matchIndex: 0 },
      { text: ' bar ', matchIndex: null },
      { text: 'FOO', matchIndex: 1 },
    ]);
  });

  it('handles adjacent matches without empty gaps', () => {
    expect(splitOnOccurrences('aa', 'a')).toEqual([
      { text: 'a', matchIndex: 0 },
      { text: 'a', matchIndex: 1 },
    ]);
  });

  it('treats an empty needle as no match', () => {
    expect(splitOnOccurrences('abc', '')).toEqual([{ text: 'abc', matchIndex: null }]);
  });
});

describe('resolveContextLimit', () => {
  it('uses the reported window when present', () => {
    expect(resolveContextLimit(40_000)).toBe(40_000);
  });

  it('falls back to the shared default budget', () => {
    expect(resolveContextLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('findReplaceableFailedRequest', () => {
  const failed = (id: string): ChatMessage => ({
    id,
    sender: 'api_request',
    text: 'API Request',
    ts: 1,
    toolStatus: 'denied',
    errorMessage: 'overloaded',
  });

  it('returns undefined with no messages', () => {
    expect(findReplaceableFailedRequest([])).toBeUndefined();
  });

  it('returns the failed request when only an empty assistant reply follows it', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'a1', sender: 'assistant', text: '', ts: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBe(0);
  });

  it('returns undefined once visible assistant output follows the failure', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'a1', sender: 'assistant', text: 'partial answer', ts: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('returns undefined when the trailing request did not fail', () => {
    const messages: ChatMessage[] = [{ id: 'r1', sender: 'api_request', text: 'API Request', ts: 1, toolStatus: 'completed' }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('stops at an error notice so fatal errors stay visible', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'e1', sender: 'error', text: 'fatal', ts: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('skips empty attempts back to the start of the failure chain', () => {
    const messages: ChatMessage[] = [
      failed('r1'),
      { id: 'a1', sender: 'assistant', text: '', ts: 2 },
      failed('r2'),
      { id: 'a2', sender: 'assistant', text: '', reasoning: '   ', ts: 3 },
    ];
    expect(findReplaceableFailedRequest(messages)).toBe(0);
  });

  it('collapses the chain even when a tool call precedes it', () => {
    const messages: ChatMessage[] = [
      { id: 't1', sender: 'tool', text: 'read_file', ts: 1 },
      failed('r1'),
      { id: 'a1', sender: 'assistant', text: '', ts: 2 },
    ];
    expect(findReplaceableFailedRequest(messages)).toBe(1);
  });
});
