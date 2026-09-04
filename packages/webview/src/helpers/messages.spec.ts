import { describe, expect, it } from 'vitest';

import { buildToolSections } from '@pi-code/shared/utilities/tool';
import {
  deliverQueuedReplies,
  groupToolMessages,
  isRenderableMessage,
  patchReplyQueue,
  previousTodos,
  resolveApproval,
  settlePendingTurns,
  upsertToolMessage,
} from '@pi-code/webview/helpers/messages';

import type { ChatMessage, ToolChatMessage, ToolName } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const SENDERS = ['user', 'assistant', 'tool', 'error', 'checkpoint', 'info', 'api_request'] as const;

const asTool = (message: ChatMessage): ToolChatMessage => message as ToolChatMessage;

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-1',
    sender: 'assistant',
    text: '',
    timestamp: 1,
    ...overrides,
  } as ChatMessage;
}

function createToolMessage(id: string, toolName: ToolName, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return createMessage({ id, sender: 'tool', toolName, toolStatus: 'completed', ...overrides });
}

describe('isRenderableMessage', () => {
  it('should render update_todo as its own row in the chat body', () => {
    expect(isRenderableMessage(createMessage({ sender: 'tool', text: 'update_todo', toolName: 'update_todo' }))).toBe(true);
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

function updateTodo(id: string, todos: TodoItem[]): ChatMessage {
  return { id, sender: 'tool', toolName: 'update_todo', text: '', timestamp: 1, todos } as ChatMessage;
}

describe('previousTodos', () => {
  it('returns the todos from the most recent prior update_todo', () => {
    const messages: ChatMessage[] = [
      updateTodo('a', [
        { content: 'one', status: 'closed' },
        { content: 'two', status: 'open' },
      ]),
      { id: 'u', sender: 'user', text: 'hi', timestamp: 2 },
      updateTodo('b', [
        { content: 'one', status: 'closed' },
        { content: 'three', status: 'active' },
      ]),
    ];
    expect(previousTodos(messages, 'b')).toEqual([
      { content: 'one', status: 'closed' },
      { content: 'two', status: 'open' },
    ]);
  });

  it('returns undefined for the first update_todo', () => {
    const messages: ChatMessage[] = [updateTodo('a', [{ content: 'one', status: 'closed' }]), updateTodo('b', [{ content: 'two', status: 'open' }])];
    expect(previousTodos(messages, 'a')).toBeUndefined();
  });

  it('returns undefined when the id is missing', () => {
    const messages: ChatMessage[] = [updateTodo('a', [{ content: 'one', status: 'closed' }])];
    expect(previousTodos(messages, 'missing')).toBeUndefined();
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

  it('should update an existing queued reply without changing its position', () => {
    const q1 = createMessage({ id: 'q1', sender: 'queue', text: 'old' });
    const later = createMessage({ id: 'later', sender: 'assistant', text: 'thinking' });
    const messages = [q1, later];

    const updated = patchReplyQueue(messages, [{ id: 'q1', sender: 'queue', text: 'new', timestamp: q1.timestamp }]);

    expect(updated.map((m) => m.id)).toEqual(['q1', 'later']);
    expect((updated[0] as any).text).toBe('new');
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
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', timestamp: 1000, pausedAt: 1000 })];

    const result = resolveApproval(messages, 't1', true);

    expect(asTool(result[0]).toolStatus).toBe('running');
    expect(result[0].timestamp).toBeGreaterThan(1000);
    expect(asTool(result[0]).pausedAt).toBeUndefined();
  });

  it('resumes the clock from where it paused when execution had already run', () => {
    // Tool ran 5s (ts=1000) before the approval was requested at pausedAt=6000,
    // so approving should continue from ~5s, not restart at zero or include the wait.
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', timestamp: 1000, pausedAt: 6000 })];

    const result = resolveApproval(messages, 't1', true);

    const elapsedAtResume = Date.now() - result[0].timestamp;
    expect(elapsedAtResume).toBeGreaterThanOrEqual(4900);
    expect(elapsedAtResume).toBeLessThanOrEqual(5100);
  });

  it('marks a rejected tool as denied', () => {
    const messages = [createToolMessage('t1', 'execute_command', { toolStatus: 'approval', timestamp: 1000, pausedAt: 1000 })];

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
      { id: 'r1', title: 'a.ts', content: 'a', language: 'text', openPath: 'a.ts', timestamp: 1, duration: undefined, status: 'completed' },
      { id: 'r2', title: 'b.ts', content: 'b', language: 'text', openPath: 'b.ts', timestamp: 1, duration: undefined, status: 'completed' },
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
      { id: 'c1', title: 'ls', content: 'a', language: 'shell', timestamp: 1, duration: undefined, status: 'completed' },
      { id: 'c2', title: 'pwd', content: 'b', language: 'shell', timestamp: 1, duration: undefined, status: 'completed' },
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
      { id: 'c1', title: 'rg -n "foo"', content: 'output', language: 'shell', timestamp: 1, duration: undefined, status: 'completed' },
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
        timestamp: 1,
        duration: undefined,
        status: 'completed',
      },
      {
        id: 's2',
        title: 'review: review code',
        subtitle: undefined,
        content: '<report-2>',
        language: 'text',
        timestamp: 1,
        duration: undefined,
        status: 'completed',
      },
    ]);
  });

  it('should nest a standalone approval under the matching parent group', () => {
    const messages = [
      createToolMessage('p1', 'read_file', { toolStatus: 'completed', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('p2', 'write_file', { toolArgs: { path: 'b.ts', content: '' }, diff: 'b' }),
      createToolMessage('a1', 'read_file', { toolStatus: 'approval', toolCallId: 'p1' }),
    ];

    const result = groupToolMessages(messages);

    // p1 and p2 are different tools, so two groups remain; a1 nests under p1's group.
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('p1');
    expect(asTool(result[0]).toolSections?.[0].approvalMessage?.id).toBe('a1');
    expect(result[1].id).toBe('p2');
  });

  it('should keep a standalone approval with no matching parent as its own row', () => {
    const messages = [
      createToolMessage('p1', 'read_file', { toolStatus: 'completed', files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('a1', 'read_file', { toolStatus: 'approval', toolCallId: 'missing' }),
    ];

    const result = groupToolMessages(messages);

    expect(result).toHaveLength(2);
    expect(result.find((m) => m.id === 'a1')).toBeDefined();
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
