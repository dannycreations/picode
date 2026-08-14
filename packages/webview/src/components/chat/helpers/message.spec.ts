import { describe, expect, it } from 'vitest';

import { deliverQueuedReplies, groupToolMessages, isRenderableMessage, upsertToolMessage } from '@pi-code/webview/components/chat/helpers/message';

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

describe('deliverQueuedReplies', () => {
  it('should convert a queued message into a user message sharing the same id', () => {
    const queued = createMessage({ id: 'q1', sender: 'queue', text: 'hi' });
    const delivered = createMessage({ id: 'q1', sender: 'user', text: 'hi' });

    const result = deliverQueuedReplies([queued], [delivered]);

    expect(result).toHaveLength(1);
    expect(result[0].sender).toBe('user');
  });

  it('should leave a failed reply queued while delivering the rest', () => {
    const queued1 = createMessage({ id: 'q1', sender: 'queue', text: 'ok' });
    const queued2 = createMessage({ id: 'q2', sender: 'queue', text: 'later' });
    const delivered = createMessage({ id: 'q1', sender: 'user', text: 'ok' });

    const result = deliverQueuedReplies([queued1, queued2], [delivered]);

    expect(result.map((m) => [m.id, m.sender])).toEqual([
      ['q1', 'user'],
      ['q2', 'queue'],
    ]);
  });

  it('should ignore an empty delivery without touching existing messages', () => {
    const queued = createMessage({ id: 'q1', sender: 'queue', text: 'hi' });

    expect(deliverQueuedReplies([queued], [])).toEqual([queued]);
  });
});

describe('upsertToolMessage', () => {
  it('should insert a tool call ahead of a trailing queued reply', () => {
    const messages = [
      createMessage({ id: 't', sender: 'assistant', reasoning: 'thinking' }),
      createMessage({ id: 'q1', sender: 'queue', text: 'stand by' }),
    ];

    const result = upsertToolMessage(messages, 'tool-1', { text: 'read_file', toolName: 'read_file', toolStatus: 'running' });

    expect(result.map((m) => m.id)).toEqual(['t', 'tool-1', 'q1']);
  });

  it('should append a tool call when no reply is queued', () => {
    const messages = [createMessage({ id: 't', sender: 'assistant', reasoning: 'thinking' })];

    const result = upsertToolMessage(messages, 'tool-1', { text: 'read_file', toolName: 'read_file' });

    expect(result.map((m) => m.id)).toEqual(['t', 'tool-1']);
  });

  it('should patch an existing tool call instead of moving it', () => {
    const messages = [createToolMessage('tool-1', 'read_file', { toolStatus: 'running' }), createMessage({ id: 'q1', sender: 'queue' })];

    const result = upsertToolMessage(messages, 'tool-1', { toolStatus: 'completed' });

    expect(result.map((m) => m.id)).toEqual(['tool-1', 'q1']);
    expect(result[0].toolStatus).toBe('completed');
  });
});

describe('groupToolMessages', () => {
  it('should collapse consecutive same-tool file calls into one merged message', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].toolName).toBe('read_file');
    expect(result[0].toolSections).toEqual([
      { title: 'a.ts', content: 'a', language: 'text', openPath: 'a.ts', ts: 1, duration: undefined, status: 'completed' },
      { title: 'b.ts', content: 'b', language: 'text', openPath: 'b.ts', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should keep separate headers when the tool name changes', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('w1', 'write_file', { toolArgs: JSON.stringify({ path: 'b.ts' }), diff: '+ b' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.toolName)).toEqual(['read_file', 'write_file']);
  });

  it('should not merge calls waiting for approval', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { toolStatus: 'approval', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { toolStatus: 'approval', files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(2);
  });

  it('should stack and group consecutive execute_command calls', () => {
    const messages = [
      createToolMessage('c1', 'execute_command', { text: 'ls', diff: 'a' }),
      createToolMessage('c2', 'execute_command', { text: 'pwd', diff: 'b' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].toolSections).toEqual([
      { title: 'ls', content: 'a', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
      { title: 'pwd', content: 'b', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should drop the tool-call placeholder and extract command from toolArgs JSON', () => {
    const messages = [
      createToolMessage('c0', 'execute_command', { text: 'execute_command' }),
      createToolMessage('c1', 'execute_command', { text: 'execute_command', toolArgs: JSON.stringify({ command: 'rg -n "foo"' }), diff: 'output' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].toolSections).toEqual([
      { title: 'rg -n "foo"', content: 'output', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should stack and group consecutive spawn_subagent calls', () => {
    const messages = [
      createToolMessage('s1', 'spawn_subagent', {
        toolArgs: JSON.stringify({ agent: 'explore', description: 'find files', task: 'x' }),
        subagent: 'explore',
        diff: '<report-1>',
      }),
      createToolMessage('s2', 'spawn_subagent', {
        toolArgs: JSON.stringify({ agent: 'review', description: 'review code', task: 'y' }),
        subagent: 'review',
        diff: '<report-2>',
      }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].toolSections).toEqual([
      { title: 'find files', subtitle: 'explore', content: '<report-1>', language: 'text', ts: 1, duration: undefined, status: 'completed' },
      { title: 'review code', subtitle: 'review', content: '<report-2>', language: 'text', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });
});
