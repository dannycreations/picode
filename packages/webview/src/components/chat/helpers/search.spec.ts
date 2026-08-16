import { describe, expect, it } from 'vitest';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';

import type { ChatMessage } from '@pi-code/shared/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sender: 'assistant', text: '', ts: 0, ...overrides };
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
