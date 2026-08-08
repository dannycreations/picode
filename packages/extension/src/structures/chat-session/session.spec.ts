import { describe, expect, it } from 'vitest';

import { collapseSkillBlock, convertSessionEntries } from '@pi-code/extension/structures/chat-session/session';

import type { SessionTreeEntry } from '@pi-code/extension/types/extension';

function skillBlock(body: string, trailing = ''): string {
  return `<skill name="pdf-form" location="/skills/pdf-form/SKILL.md">\n${body}\n</skill>${trailing}`;
}

describe('collapseSkillBlock', () => {
  it('should fold an expanded skill block back into the command the user typed', () => {
    expect(collapseSkillBlock(skillBlock('References are relative to /skills/pdf-form.\n\n# PDF Form'))).toBe('/skill:pdf-form');
  });

  it('should keep the arguments that followed the command', () => {
    expect(collapseSkillBlock(skillBlock('# PDF Form', '\n\nfill in page 2'))).toBe('/skill:pdf-form fill in page 2');
  });

  it('should leave ordinary messages untouched', () => {
    expect(collapseSkillBlock('just a normal message')).toBe('just a normal message');
    expect(collapseSkillBlock('talking about <skill> tags inline')).toBe('talking about <skill> tags inline');
  });
});

describe('convertSessionEntries user messages', () => {
  it('should render a reloaded skill invocation as the original command', () => {
    const entries: SessionTreeEntry[] = [
      {
        id: 'u1',
        type: 'message',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: skillBlock('# PDF Form', '\n\nfill in page 2') },
      },
    ];

    expect(convertSessionEntries(entries)[0].text).toBe('/skill:pdf-form fill in page 2');
  });
});

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
