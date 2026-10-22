import { describe, expect, it } from 'vitest';

import { buildToolSections } from '@pi-code/shared/utilities/tool';
import {
  appendAssistantDelta,
  buildChatRenderModel,
  deliverQueuedReplies,
  groupToolMessages,
  messageVisibility,
  patchReplyQueue,
  patchToolRow,
  resolveApproval,
  settlePendingTurns,
  startApiRequest,
  upsertToolRow,
} from '@pi-code/webview/helpers/messages';

import type { ChatMessage, ToolChatMessage, ToolName } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const SENDERS = ['user', 'assistant', 'tool', 'error', 'checkpoint', 'api_request'] as const;

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

const isRenderable = (message: ChatMessage): boolean => messageVisibility(message).renderable;

describe('messageVisibility', () => {
  it('should render update_todo as its own row in the chat body', () => {
    expect(isRenderable(createMessage({ sender: 'tool', text: 'update_todo', toolName: 'update_todo' }))).toBe(true);
    expect(isRenderable(createMessage({ sender: 'tool', text: 'read_file', toolName: 'read_file' }))).toBe(true);
  });

  it('should hide an assistant turn until it has content', () => {
    expect(isRenderable(createMessage({ text: '' }))).toBe(false);
    expect(isRenderable(createMessage({ text: '   \n  ' }))).toBe(false);
    expect(isRenderable(createMessage({ text: '', reasoning: '  ' }))).toBe(false);
  });

  it('should show an assistant turn once text or reasoning arrives', () => {
    expect(isRenderable(createMessage({ text: 'H' }))).toBe(true);
    expect(isRenderable(createMessage({ text: '', reasoning: 'thinking' }))).toBe(true);
  });

  it('should always show senders that carry no incremental content', () => {
    for (const sender of SENDERS.filter((s) => s !== 'assistant')) {
      expect(isRenderable(createMessage({ sender, text: '' }))).toBe(true);
    }
  });
});

function updateTodo(id: string, todos: TodoItem[]): ChatMessage {
  return { id, sender: 'tool', toolName: 'update_todo', text: '', timestamp: 1, todos } as ChatMessage;
}

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

describe('appendAssistantDelta', () => {
  it('appends the fragment to the answer that is streaming in', () => {
    const messages = [createMessage({ id: 'a1', sender: 'assistant', text: '' })];

    const result = appendAssistantDelta(messages, 'Hello', undefined);

    expect(result[0].text).toBe('Hello');
    expect((result[0] as { reasoning?: string }).reasoning).toBeUndefined();
  });

  it('keeps the answer hidden while it holds nothing the user can see', () => {
    const messages = [createMessage({ id: 'a1', sender: 'assistant', text: '' })];

    const blank = appendAssistantDelta(messages, '   ', undefined);
    expect(isRenderable(blank[0])).toBe(false);

    const visible = appendAssistantDelta(blank, 'x', undefined);
    expect(isRenderable(visible[0])).toBe(true);
  });

  it('keeps an answer that already showed something visible', () => {
    const messages = [createMessage({ id: 'a1', sender: 'assistant', text: 'Hi' })];

    const result = appendAssistantDelta(messages, ' there', undefined);

    expect(result[0].text).toBe('Hi there');
    expect(isRenderable(result[0])).toBe(true);
  });

  it('streams the reasoning apart from the answer', () => {
    const messages = [createMessage({ id: 'a1', sender: 'assistant', text: '' })];

    const result = appendAssistantDelta(messages, undefined, 'thinking');

    expect((result[0] as { reasoning?: string }).reasoning).toBe('thinking');
    expect(result[0].text).toBe('');
    expect(isRenderable(result[0])).toBe(true);
  });

  it('leaves the transcript alone when no answer is streaming', () => {
    const messages = [createMessage({ id: 'u1', sender: 'user', text: 'hi' })];

    expect(appendAssistantDelta(messages, 'x', undefined)).toBe(messages);
  });

  it('reports what the answer shows', () => {
    const messages = [createMessage({ id: 'a1', sender: 'assistant', text: '' })];
    const result = appendAssistantDelta(messages, 'Hello', undefined);

    expect(messageVisibility(result[0]).hasText).toBe(true);
    expect(messageVisibility(result[0]).hasReasoning).toBe(false);
  });
});

describe('startApiRequest', () => {
  it('adds the request row and settles the turns that are still open', () => {
    const messages = [
      createMessage({ id: 'a1', sender: 'assistant', toolStatus: 'running' }),
      createMessage({ id: 'u1', sender: 'user', text: 'hi' }),
    ];

    const result = startApiRequest(messages, 'req-1', 5);

    expect(result.map((m) => m.id)).toEqual(['a1', 'u1', 'req-1']);
    expect((result[0] as any).toolStatus).toBe('completed');
    expect((result[2] as any).toolStatus).toBe('running');
  });

  it('takes the slot of the failed request it retries', () => {
    const messages = [
      createMessage({ id: 'u1', sender: 'user', text: 'hi' }),
      createMessage({ id: 'req-0', sender: 'api_request', toolStatus: 'denied' }),
    ];

    const result = startApiRequest(messages, 'req-1', 5);

    expect(result.map((m) => m.id)).toEqual(['u1', 'req-1']);
  });

  it('drops the retry deadline a waiting request left behind', () => {
    const messages = [createMessage({ id: 'req-0', sender: 'api_request', toolStatus: 'completed', retryAt: 123 })];

    const result = startApiRequest(messages, 'req-1', 5);

    expect((result[0] as any).retryAt).toBeUndefined();
  });

  it('leaves the transcript alone when the request is already on screen', () => {
    const messages = [createMessage({ id: 'req-1', sender: 'api_request', toolStatus: 'running' })];

    expect(startApiRequest(messages, 'req-1', 5)).toBe(messages);
  });

  it('places the request row ahead of a queued reply', () => {
    // The reply waits at the bottom of the transcript, so the request of the
    // turn it triggers lands above it.
    const messages = [
      createMessage({ id: 'a1', sender: 'assistant', text: '', toolStatus: 'running' }),
      createMessage({ id: 'q1', sender: 'queue', text: 'stand by' }),
    ];

    const result = startApiRequest(messages, 'req-1', 5);

    expect(result.map((m) => m.id)).toEqual(['a1', 'req-1', 'q1']);
  });

  it('keeps a queued reply when the retry takes over the failed request row', () => {
    const messages = [
      createMessage({ id: 'req-0', sender: 'api_request', toolStatus: 'denied' }),
      createMessage({ id: 'q1', sender: 'queue', text: 'stand by' }),
    ];

    const result = startApiRequest(messages, 'req-1', 5);

    expect(result.map((m) => m.id)).toEqual(['req-1', 'q1']);
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

  it('hands back a row whose sections are already built, so the chat body memo can hit', () => {
    // Every streamed token rebuilds the transcript, so a fresh object here
    // would re-render every mounted tool row instead of only the one streaming.
    const settled = asTool(createToolMessage('t1', 'read_file', { toolStatus: 'completed', files: [{ path: 'a.ts', content: 'a' }] }));
    const withSections = { ...settled, toolSections: buildToolSections(settled) };

    const result = groupToolMessages([withSections, createMessage({ id: 'u1', sender: 'user' })]);

    expect(result[0]).toBe(withSections);
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

  it('settles only the named row when an id is given', () => {
    // A turn reports its cost and error against one request row, so the other
    // running turn belongs to a later request and must stay running.
    const messages = [
      createMessage({ id: 'm1', sender: 'api_request', toolStatus: 'running' }),
      createMessage({ id: 'm2', sender: 'assistant', toolStatus: 'running' }),
    ];

    const result = settlePendingTurns(messages, { cost: 0.5 }, 'm1');

    expect((result[0] as any).toolStatus).toBe('completed');
    expect((result[0] as any).cost).toBe(0.5);
    expect((result[1] as any).toolStatus).toBe('running');
  });

  it('applies the terminal patch to a row a mid-turn event already closed', () => {
    // message_start settles the in-flight request row before api_request_end
    // arrives, but the terminal event still owns the row's final state.
    const messages = [
      createMessage({ id: 'm1', sender: 'api_request', toolStatus: 'completed' }),
      createMessage({ id: 'm2', sender: 'assistant', toolStatus: 'running' }),
    ];

    const result = settlePendingTurns(messages, { error: 'overloaded' }, 'm1');

    expect((result[0] as any).toolStatus).toBe('denied');
    expect((result[0] as any).errorMessage).toBe('overloaded');
    expect((result[1] as any).toolStatus).toBe('running');
  });
});

describe('upsertToolRow', () => {
  it('creates the row with its sections so the renderer never rebuilds them', () => {
    const rows = upsertToolRow([], 't1', {
      text: 'read_file',
      toolName: 'read_file',
      toolStatus: 'running',
      files: [{ path: 'a.ts', content: 'a' }],
    });

    expect(rows).toHaveLength(1);
    expect(asTool(rows[0]).toolSections).toHaveLength(1);
  });

  it('places a new row ahead of a queued reply and settles the open turns', () => {
    const messages: ChatMessage[] = [
      createMessage({ id: 'a1', sender: 'assistant', text: '', toolStatus: 'running' }),
      createMessage({ id: 'q1', sender: 'queue', text: 'stand by' }),
    ];

    const rows = upsertToolRow(messages, 't1', { text: 'read_file', toolName: 'read_file', toolStatus: 'running' });

    expect(rows.map((m) => m.id)).toEqual(['a1', 't1', 'q1']);
    expect((rows[0] as { toolStatus?: string }).toolStatus).toBe('completed');
  });

  it('refreshes an existing row in place', () => {
    const messages = [createToolMessage('t1', 'read_file', { toolStatus: 'running', files: [{ path: 'a.ts', content: 'a' }] })];

    const rows = upsertToolRow(messages, 't1', { toolStatus: 'completed' });

    expect(rows.map((m) => m.id)).toEqual(['t1']);
    expect(asTool(rows[0]).toolStatus).toBe('completed');
    expect(asTool(rows[0]).toolSections).toHaveLength(1);
  });
});

describe('patchToolRow', () => {
  it('patches the row and rebuilds its sections from the patched row', () => {
    const rows = upsertToolRow([], 't1', {
      text: 'read_file',
      toolName: 'read_file',
      toolStatus: 'running',
      files: [{ path: 'a.ts', content: 'a' }],
    });

    const patched = patchToolRow(rows, 't1', undefined, () => ({ diff: '+changed' }));

    expect(asTool(patched[0]).diff).toBe('+changed');
    expect(asTool(patched[0]).toolSections).toHaveLength(1);
  });

  it('leaves the transcript alone for a sub-agent event with no row of its own', () => {
    const rows = upsertToolRow([], 't1', { text: 'read_file', toolName: 'read_file', toolStatus: 'running' });

    const patched = patchToolRow(rows, 'other', 'explore', () => ({ diff: 'x' }));

    expect(patched).toBe(rows);
  });

  it('leaves the transcript alone when the row does not exist at all', () => {
    const rows = upsertToolRow([], 't1', { text: 'read_file', toolName: 'read_file', toolStatus: 'running' });

    const patched = patchToolRow(rows, 'other', undefined, () => ({ diff: 'x' }));

    expect(patched).toBe(rows);
  });
});

describe('buildChatRenderModel', () => {
  it('hides an assistant turn that has no content yet', () => {
    const model = buildChatRenderModel([
      createMessage({ id: 'a1', sender: 'assistant', text: '' }),
      createMessage({ id: 'u1', sender: 'user', text: 'hi' }),
    ]);

    expect(model.renderItems.map((m) => m.id)).toEqual(['u1']);
  });

  it('reports a pending approval and the newest checklist', () => {
    const todos: TodoItem[] = [{ content: 'one', status: 'open' }];
    const model = buildChatRenderModel([createToolMessage('t1', 'read_file', { toolStatus: 'approval' }), updateTodo('u1', todos)]);

    expect(model.hasApproval).toBe(true);
    expect(model.latestTodos).toEqual(todos);
    expect(model.oldTodosById.has('u1')).toBe(false);
  });

  it('maps each update_todo row to the checklist from the most recent prior one', () => {
    const first: TodoItem[] = [
      { content: 'one', status: 'closed' },
      { content: 'two', status: 'open' },
    ];
    const model = buildChatRenderModel([
      updateTodo('a', first),
      { id: 'u', sender: 'user', text: 'hi', timestamp: 2 },
      updateTodo('b', [{ content: 'one', status: 'closed' }]),
    ]);

    expect(model.oldTodosById.get('b')).toEqual(first);
    expect(model.oldTodosById.has('a')).toBe(false);
    expect(model.oldTodosById.has('u')).toBe(false);
  });

  it('groups the tool rows the way the chat body renders them', () => {
    const model = buildChatRenderModel([
      createToolMessage('r1', 'read_file', { files: [{ path: 'a.ts', content: 'a' }] }),
      createToolMessage('r2', 'read_file', { files: [{ path: 'b.ts', content: 'b' }] }),
    ]);

    expect(model.renderItems).toHaveLength(1);
    expect(model.renderItems[0].id).toBe('r1');
  });
});
