import { describe, expect, it } from 'vitest';

import { groupFileToolMessages, isRenderableMessage } from '@pi-code/webview/components/chat/helpers/message';

import type { ChatMessage, ToolName } from '@pi-code/shared/core/types';

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

function createToolMessage(id: string, toolName: ToolName, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return createMessage({ id, sender: 'tool', toolName, toolStatus: 'completed', ...overrides });
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

describe('groupFileToolMessages', () => {
  it('should collapse consecutive same-tool file calls into one merged message', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupFileToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].toolName).toBe('read_file');
    expect(result[0].files).toEqual([
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
    ]);
  });

  it('should keep separate headers when the tool name changes', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('w1', 'write_file', { toolArgs: JSON.stringify({ path: 'b.ts' }), diff: '+ b' }),
    ];

    const result = groupFileToolMessages(messages);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.toolName)).toEqual(['read_file', 'write_file']);
  });

  it('should not merge calls waiting for approval', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { toolStatus: 'approval', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { toolStatus: 'approval', files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupFileToolMessages(messages);

    expect(result).toHaveLength(2);
  });
});
