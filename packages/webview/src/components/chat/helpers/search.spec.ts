import { describe, expect, it } from 'vitest';

import { countOccurrences, getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';

import type { ChatMessage } from '@pi-code/shared/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sender: 'assistant', text: '', ts: 0, ...overrides };
}

describe('countOccurrences', () => {
  it('returns 0 for an empty query without error', () => {
    expect(countOccurrences('anything', '')).toBe(0);
  });

  it('counts case-insensitively and non-overlapping', () => {
    expect(countOccurrences('Foo foo FOO', 'foo')).toBe(3);
    expect(countOccurrences('aaa', 'aa')).toBe(1);
  });

  it('returns 0 when there is no match', () => {
    expect(countOccurrences('hello world', 'xyz')).toBe(0);
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
        toolArgs: JSON.stringify({ question: 'Pick one', suggestions: [] }),
        diff: JSON.stringify({ details: { response: 'answer' } }),
      }),
    );
    expect(text).toContain('Pick one');
    expect(text).toContain('answer');
  });
});
