import { describe, expect, it } from 'vitest';

import { getRowContainmentStyle, getRowHeightEstimate, isRenderableMessage } from '@extension/webview/components/chat/helpers/message';

import type { ChatMessage } from '@extension/types/webview';

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

describe('getRowHeightEstimate', () => {
  it('should provide a usable placeholder for every sender', () => {
    for (const sender of SENDERS) {
      expect(getRowHeightEstimate(sender)).toBeGreaterThan(0);
    }
  });

  it('should scale with how much content a row typically holds', () => {
    expect(getRowHeightEstimate('info')).toBeLessThan(getRowHeightEstimate('user'));
    expect(getRowHeightEstimate('user')).toBeLessThan(getRowHeightEstimate('tool'));
    expect(getRowHeightEstimate('tool')).toBeLessThan(getRowHeightEstimate('assistant'));
  });
});

describe('getRowContainmentStyle', () => {
  it('should let the browser remember the real height once measured', () => {
    expect(getRowContainmentStyle('assistant')).toEqual({ containIntrinsicSize: 'auto 200px' });
  });

  it('should return a stable object so memoised rows are not invalidated', () => {
    expect(getRowContainmentStyle('tool')).toBe(getRowContainmentStyle('tool'));
  });
});
