import { describe, expect, it } from 'vitest';

import { findOccurrences, splitOnOccurrences } from '@pi-code/shared/utilities/common';
import { getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';

import type { ChatMessage } from '@pi-code/shared/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sender: 'assistant', text: '', timestamp: 0, ...overrides } as ChatMessage;
}

describe('findOccurrences', () => {
  it('returns 0 for an empty query without error', () => {
    expect(findOccurrences('anything', '').length).toBe(0);
  });

  it('counts case-insensitively and non-overlapping', () => {
    expect(findOccurrences('Foo foo FOO', 'foo').length).toBe(3);
    expect(findOccurrences('aaa', 'aa').length).toBe(1);
  });

  it('returns 0 when there is no match', () => {
    expect(findOccurrences('hello world', 'xyz').length).toBe(0);
  });
});

describe('splitOnOccurrences', () => {
  it('reports the same match count as findOccurrences', () => {
    const text = 'foo bar foo';
    const matched = splitOnOccurrences(text, 'foo').filter((segment) => segment.matchIndex !== null);
    expect(matched.map((segment) => segment.matchIndex)).toEqual([0, 1]);
    expect(matched.map((segment) => segment.text)).toEqual(['foo', 'foo']);
    expect(matched.length).toBe(findOccurrences(text, 'foo').length);
  });

  it('yields a single unmatched segment when the query is absent', () => {
    const segments = splitOnOccurrences('hello', 'xyz');
    expect(segments).toEqual([{ text: 'hello', matchIndex: null }]);
  });
});

describe('getMessageSearchText', () => {
  it('concatenates reasoning then text for assistant messages', () => {
    const text = getMessageSearchText(makeMessage({ sender: 'assistant', reasoning: 'think', text: 'say' }));
    expect(text).toBe('think\nsay');
  });

  it('includes the question and answer for ask_question tools', () => {
    const text = getMessageSearchText(
      makeMessage({
        sender: 'tool',
        toolName: 'ask_question',
        toolArgs: { question: 'Pick one', follow_up: [] },
        diff: JSON.stringify({ details: { response: 'answer' } }),
      }),
    );
    expect(text).toContain('Pick one');
    expect(text).toContain('answer');
  });
});
