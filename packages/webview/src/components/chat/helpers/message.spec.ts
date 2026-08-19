import { describe, expect, it } from 'vitest';

import { buildToolSections } from '@pi-code/shared/utilities/tool';
import {
  deliverQueuedReplies,
  groupToolMessages,
  isRenderableMessage,
  resolveApproval,
  settlePendingTurns,
  upsertToolMessage,
} from '@pi-code/webview/components/chat/helpers/message';

import type { ChatMessage, ToolChatMessage, ToolName } from '@pi-code/shared/core/types';

const SENDERS = ['user', 'assistant', 'tool', 'error', 'checkpoint', 'info', 'api_request'] as const;

const asTool = (message: ChatMessage): ToolChatMessage => message as ToolChatMessage;

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-1',
    sender: 'assistant',
    text: '',
    ts: 1,
    ...overrides,
  } as ChatMessage;
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
    expect(asTool(result[0]).toolStatus).toBe('completed');
  });
});

describe('resolveApproval', () => {
  it('resumes an approved tool as running and continues its clock past the wait', () => {
    // Tool started at ts=1000, approval requested immediately (pausedAt=1000), so
    // the elapsed clock should restart from ~0 rather than jump by the wait.
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', ts: 1000, pausedAt: 1000 })];

    const result = resolveApproval(messages, 't1', true);

    expect(asTool(result[0]).toolStatus).toBe('running');
    expect(result[0].ts).toBeGreaterThan(1000);
    expect(asTool(result[0]).pausedAt).toBeUndefined();
  });

  it('resumes the clock from where it paused when execution had already run', () => {
    // Tool ran 5s (ts=1000) before the approval was requested at pausedAt=6000,
    // so approving should continue from ~5s, not restart at zero or include the wait.
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', ts: 1000, pausedAt: 6000 })];

    const result = resolveApproval(messages, 't1', true);

    const elapsedAtResume = Date.now() - result[0].ts;
    expect(elapsedAtResume).toBeGreaterThanOrEqual(4900);
    expect(elapsedAtResume).toBeLessThanOrEqual(5100);
  });

  it('marks a rejected tool as denied', () => {
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', ts: 1000, pausedAt: 1000 })];

    const result = resolveApproval(messages, 't1', false);

    expect(asTool(result[0]).toolStatus).toBe('denied');
    expect(asTool(result[0]).pausedAt).toBeUndefined();
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
    expect(asTool(result[0]).toolName).toBe('read_file');
    expect(asTool(result[0]).toolSections).toEqual([
      { id: 'r1', title: 'a.ts', content: 'a', language: 'text', openPath: 'a.ts', ts: 1, duration: undefined, status: 'completed' },
      { id: 'r2', title: 'b.ts', content: 'b', language: 'text', openPath: 'b.ts', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should keep separate headers when the tool name changes', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('w1', 'write_file', { toolArgs: { path: 'b.ts', content: '' }, diff: '+ b' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(2);
    expect(result.map((m) => asTool(m).toolName)).toEqual(['read_file', 'write_file']);
  });

  it('should stack a pending approval beneath its completed tool sibling', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { toolStatus: 'completed', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { toolStatus: 'approval', files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toHaveLength(2);
    expect(asTool(result[0]).toolSections?.[1].approvalMessage?.id).toBe('r2');
  });

  it('should stack consecutive tool calls that are both awaiting approval', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { toolStatus: 'approval', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { toolStatus: 'approval', files: [{ path: 'b.ts', content: 'b' }] }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toHaveLength(2);
  });

  it('should stack a later approval with earlier completed calls of the same tool', () => {
    const messages = [
      createToolMessage('r1', 'read_file', { toolStatus: 'completed', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { toolStatus: 'completed', files: [{ path: 'b.ts', content: 'b' }] }),
      createToolMessage('r3', 'read_file', { toolStatus: 'approval', files: [{ path: 'c.ts', content: 'c' }] }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toHaveLength(3);
    expect(asTool(result[0]).toolSections?.[2].approvalMessage?.id).toBe('r3');
  });

  it('should stack and group consecutive execute_command calls', () => {
    const messages = [
      createToolMessage('c1', 'execute_command', { text: 'ls', diff: 'a' }),
      createToolMessage('c2', 'execute_command', { text: 'pwd', diff: 'b' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toEqual([
      { id: 'c1', title: 'ls', content: 'a', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
      { id: 'c2', title: 'pwd', content: 'b', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should drop the tool-call placeholder and extract command from toolArgs JSON', () => {
    const messages = [
      createToolMessage('c0', 'execute_command', { text: 'execute_command' }),
      createToolMessage('c1', 'execute_command', { text: 'execute_command', toolArgs: { command: 'rg -n "foo"' }, diff: 'output' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toEqual([
      { id: 'c1', title: 'rg -n "foo"', content: 'output', language: 'shell', ts: 1, duration: undefined, status: 'completed' },
    ]);
  });

  it('should stack and group consecutive spawn_subagent calls', () => {
    const messages = [
      createToolMessage('s1', 'spawn_subagent', {
        toolArgs: { agent: 'explore', description: 'find files', task: 'x' },
        subagent: 'explore',
        diff: '<report-1>',
      }),
      createToolMessage('s2', 'spawn_subagent', {
        toolArgs: { agent: 'review', description: 'review code', task: 'y' },
        subagent: 'review',
        diff: '<report-2>',
      }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(1);
    expect(asTool(result[0]).toolSections).toEqual([
      {
        id: 's1',
        title: 'explore: find files',
        subtitle: undefined,
        content: '<report-1>',
        language: 'text',
        ts: 1,
        duration: undefined,
        status: 'completed',
      },
      {
        id: 's2',
        title: 'review: review code',
        subtitle: undefined,
        content: '<report-2>',
        language: 'text',
        ts: 1,
        duration: undefined,
        status: 'completed',
      },
    ]);
  });
});

describe('buildToolSections subagent', () => {
  it('should render the subtitle directly as ToolSection.subtitle', () => {
    const msg = createToolMessage('t1', 'spawn_subagent', {
      toolArgs: { agent: 'explore', description: 'find files', task: 'x' },
      subtitle: '5 turns, 74050 in / 14399 out, $0.0000',
    });

    const [section] = buildToolSections(msg);

    expect(section.title).toBe('explore: find files');
    expect(section.subtitle).toBe('5 turns, 74050 in / 14399 out, $0.0000');
  });
});

describe('settlePendingTurns', () => {
  it('should transition running api_request and assistant messages to completed', () => {
    const messages = [
      createMessage({ id: 'm1', sender: 'api_request', toolStatus: 'running' }),
      createMessage({ id: 'm2', sender: 'assistant', toolStatus: 'running' }),
    ];

    const result = settlePendingTurns(messages);

    expect((result[0] as any).toolStatus).toBe('completed');
    expect((result[1] as any).toolStatus).toBe('completed');
  });
});
