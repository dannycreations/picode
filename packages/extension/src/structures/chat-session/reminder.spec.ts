import { describe, expect, it } from 'vitest';

import { formatTodoReminder, getLatestTodoList, hasReminders, withTodoProgress } from '@pi-code/extension/structures/chat-session/reminder';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const todos: TodoItem[] = [
  { content: 'a', status: 'closed' },
  { content: 'b', status: 'active' },
];

describe('formatTodoReminder', () => {
  it('gives a creation hint when no list exists', () => {
    expect(formatTodoReminder(undefined)).toContain('`update_todo`');
    expect(formatTodoReminder([])).toContain('`update_todo`');
  });

  it('renders the current checklist with a status-update nudge', () => {
    const out = formatTodoReminder(todos);
    expect(out).toContain('| 1 | a | Closed |');
    expect(out).toContain('| 2 | b | Active |');
    expect(out).toContain('call the `update_todo` tool');
  });
});

describe('getLatestTodoList', () => {
  it('returns the most recent update_todo result from history', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'update_todo',
        content: [],
        details: { todos: [{ content: 'old', status: 'open' }] },
        isError: false,
        timestamp: 0,
      },
      { role: 'toolResult', toolCallId: '2', toolName: 'read_file', content: [], details: {}, isError: false, timestamp: 0 },
      { role: 'toolResult', toolCallId: '3', toolName: 'update_todo', content: [], details: { todos: todos }, isError: false, timestamp: 0 },
    ];
    expect(getLatestTodoList(messages)).toEqual(todos);
  });

  it('returns undefined when no update_todo result exists', () => {
    expect(getLatestTodoList([{ role: 'user', content: 'hi', timestamp: 0 }])).toBeUndefined();
  });
});

describe('withTodoProgress', () => {
  const base: AgentMessage[] = [
    { role: 'user', content: 'hello', timestamp: 0 },
    { role: 'user', content: 'ok', timestamp: 0 },
  ];

  it('appends exactly one reminder and leaves other history intact', () => {
    const out = withTodoProgress(base, todos);
    expect(out.length).toBe(base.length + 1);
    expect(out.filter(hasReminders)).toHaveLength(1);
  });

  it('replaces the previous reminder instead of accumulating across turns', () => {
    const once = withTodoProgress(base, todos);
    const twice = withTodoProgress(once, todos);
    expect(twice.filter(hasReminders)).toHaveLength(1);
    expect(twice.length).toBe(base.length + 1);
  });

  it('does not mutate the input array', () => {
    const out = withTodoProgress(base, todos);
    expect(out).not.toBe(base);
    expect(base).toHaveLength(2);
  });
});
