export type TodoStatus = 'pending' | 'progress' | 'completed';

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export function getScrollIndex(todos: readonly TodoItem[]): number {
  const inProgressIdx = todos.findIndex((todo) => todo.status === 'progress');
  if (inProgressIdx !== -1) return inProgressIdx;
  return todos.findIndex((todo) => todo.status !== 'completed');
}
