export type TodoStatus = 'completed' | 'in_progress' | 'pending';

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export function parseTodoList(todoListStr: string): TodoItem[] {
  const lines = todoListStr.split(/\r?\n/);
  const list: TodoItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s*(.+)$/);
    if (!match) continue;
    const indicator = match[1].toLowerCase();
    const status: TodoStatus = indicator === 'x' ? 'completed' : indicator === '-' || indicator === '~' ? 'in_progress' : 'pending';
    list.push({ content: match[2].trim(), status });
  }
  return list;
}

export function getScrollIndex(todos: readonly TodoItem[]): number {
  const inProgressIdx = todos.findIndex((todo) => todo.status === 'in_progress');
  if (inProgressIdx !== -1) return inProgressIdx;
  return todos.findIndex((todo) => todo.status !== 'completed');
}

export function getMostImportantTodo(todos: readonly TodoItem[]): TodoItem | undefined {
  return todos[getScrollIndex(todos)];
}
