import { describe, expect, it } from 'vitest';

import { isRenderableMessage } from '@pi-code/webview/components/chat/helpers/message';

import type { ChatMessage } from '@pi-code/shared/core/types';

const SENDERS = ['user', 'assistant', 'tool', 'error', 'checkpoint', 'info', 'api_request'] as const;

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-1',
    sender: 'assistant',
    text: '',
    ts: 1,
    ...overrides,
  };
}

describe('isRenderableMessage', () => {
  it('should hide tool calls that are surfaced elsewhere in the UI', () => {
    expect(isRenderableMessage(createMessage({ sender: 'tool', text: 'update_todo', toolName: 'update_todo' }))).toBe(false);
    expect(isRenderableMessage(createMessage({ sender: 'tool', text: 'read_file', toolName: 'read_file' }))).toBe(true);
  });

  it('should hide an assistant turn until it has content', () => {
    expect(isRenderableMessage(createMessage({ text: '' }))).toBe(false);
    expect(isRenderableMessage(createMessage({ text: '   \n  ' }))).toBe(false);
    expect(isRenderableMessage(createMessage({ text: '', reasoning: '  ' }))).toBe(false);
  });

  it('should show an assistant turn once text or reasoning arrives', () => {
    expect(isRenderableMessage(createMessage({ text: 'H' }))).toBe(true);
    expect(isRenderableMessage(createMessage({ text: '', reasoning: 'thinking' }))).toBe(true);
  });

  it('should always show senders that carry no incremental content', () => {
    for (const sender of SENDERS.filter((s) => s !== 'assistant')) {
      expect(isRenderableMessage(createMessage({ sender, text: '' }))).toBe(true);
    }
  });
});
