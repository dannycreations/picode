export const TODO_STATUSES = ['pending', 'progress', 'completed'] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export function getScrollIndex(todos: readonly TodoItem[]): number {
  const inProgressIdx = todos.findIndex((todo) => todo.status === 'progress');
  if (inProgressIdx !== -1) return inProgressIdx;
  return todos.findIndex((todo) => todo.status !== 'completed');
}
