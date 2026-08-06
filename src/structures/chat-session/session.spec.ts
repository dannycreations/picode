import { describe, expect, it } from 'vitest';

import { convertSessionEntries } from '@extension/structures/chat-session/session';

import type { SessionTreeEntry } from '@extension/types/extension';

describe('convertSessionEntries todo parsing', () => {
  it('attaches the parsed update_todo list to the message', () => {
    const entries: SessionTreeEntry[] = [
      {
        id: 'm1',
        type: 'message',
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tc1', name: 'update_todo', arguments: '{"todos":"- [ ] a"}' }],
        },
      },
      {
        id: 'm2',
        type: 'message',
        timestamp: new Date().toISOString(),
        message: {
          role: 'toolResult',
          toolCallId: 'tc1',
          content: 'update_todo success.',
          details: {
            todos: [
              { content: 'Task A', status: 'pending' },
              { content: 'Task B', status: 'completed' },
            ],
          },
        },
      },
    ];

    const messages = convertSessionEntries(entries);
    const todoMsg = messages.find((m) => m.toolName === 'update_todo');

    expect(todoMsg?.todos).toEqual([
      { content: 'Task A', status: 'pending' },
      { content: 'Task B', status: 'completed' },
    ]);
  });
});
