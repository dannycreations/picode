export const TODO_STATUSES = ['open', 'active', 'closed'] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export function getScrollIndex(todos: readonly TodoItem[]): number {
  const inProgressIdx = todos.findIndex((todo) => todo.status === 'active');
  if (inProgressIdx !== -1) return inProgressIdx;
  return todos.findIndex((todo) => todo.status !== 'closed');
}

export function getVisibleTodos(oldTodos: readonly TodoItem[], newTodos: readonly TodoItem[]): readonly TodoItem[] {
  if (oldTodos.length === 0) return newTodos;

  const changed = newTodos.filter((todo) => {
    if (todo.status !== 'closed' && todo.status !== 'active') return false;
    const previous = oldTodos.find((p) => p.content === todo.content);
    return !previous || previous.status !== todo.status;
  });

  return changed.length > 0 ? changed : newTodos;
}
