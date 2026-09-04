import { contentText } from '@earendil-works/pi-ai';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const STATUS_MAP: Record<TodoItem['status'], string> = {
  open: 'Open',
  active: 'Active',
  closed: 'Closed',
};

const TODO_REMINDER_SECTION = '## Todo Reminders';

export function formatTodoReminder(todoList?: TodoItem[]): string {
  const lines: string[] = [TODO_REMINDER_SECTION, ''];

  if (!todoList || todoList.length === 0) {
    lines.push('You have not created a todo list yet. Create one with `update_todo` if your task is complex or involves multiple steps.');
    lines.push("You can safely ignore this reminder if it isn't needed yet, and don't cite it anywhere.");
    return lines.join('\n').trim();
  }

  lines.push('Below is a list of your current reminders for this task. Keep them updated or expand as you progress.', '');
  lines.push('| # | Content | Status |');
  lines.push('|---|---------|--------|');
  todoList.forEach((item, idx) => {
    const escapedContent = item.content.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    lines.push(`| ${idx + 1} | ${escapedContent} | ${STATUS_MAP[item.status] || item.status} |`);
  });
  lines.push('');

  lines.push('IMPORTANT: When task status changes, remember to call the `update_todo` tool to track your progress.');
  return lines.join('\n').trim();
}

export function hasReminders(msg: AgentMessage): boolean {
  return msg.role === 'user' && contentText(msg.content).trimStart().startsWith(TODO_REMINDER_SECTION);
}

export function withTodoProgress(messages: readonly AgentMessage[], todoList?: TodoItem[]): AgentMessage[] {
  const injected: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: formatTodoReminder(todoList) }],
    timestamp: Date.now(),
  };
  const filtered = messages.filter((msg) => !hasReminders(msg));
  return [...filtered, injected];
}

export function getLatestTodoList(messages: readonly AgentMessage[]): TodoItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'toolResult' && msg.toolName === 'update_todo') {
      const details: { todos?: TodoItem[] } | undefined = msg.details;
      if (details?.todos) return details.todos;
    }
  }
  return undefined;
}
