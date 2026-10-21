import { describe, expect, it } from 'vitest';

import { getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';

import type { ChatMessage } from '@pi-code/shared/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', sender: 'assistant', text: '', timestamp: 0, ...overrides } as ChatMessage;
}

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
