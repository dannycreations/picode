import type { ChatMessage } from '@extension/types/webview';

export type TodoStatus = 'completed' | 'in_progress' | 'pending';

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export function extractTodos(messages: ChatMessage[]): TodoItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.toolName === 'update_todo' && msg.diff) {
      try {
        const parsed = JSON.parse(msg.diff);
        const todos = parsed?.details?.todos;
        if (typeof todos !== 'string') return undefined;

        const list: TodoItem[] = [];
        for (const line of todos.split('\n')) {
          const match = line.match(/^-\s*\[([ xX\-~])\]\s*(.+)$/);
          if (!match) continue;
          const indicator = match[1].toLowerCase();
          const status: TodoStatus = indicator === 'x' ? 'completed' : indicator === '-' || indicator === '~' ? 'in_progress' : 'pending';
          list.push({ content: match[2], status });
        }
        return list;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function getScrollIndex(todos: readonly TodoItem[]): number {
  const inProgressIdx = todos.findIndex((todo) => todo.status === 'in_progress');
  if (inProgressIdx !== -1) return inProgressIdx;
  return todos.findIndex((todo) => todo.status !== 'completed');
}

export function getMostImportantTodo(todos: readonly TodoItem[]): TodoItem | undefined {
  return todos.find((todo) => todo.status === 'in_progress') || todos.find((todo) => todo.status !== 'completed');
}
