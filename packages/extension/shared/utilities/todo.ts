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

  const previousStatusByContent = new Map<string, TodoStatus>();
  for (const todo of oldTodos) {
    if (!previousStatusByContent.has(todo.content)) previousStatusByContent.set(todo.content, todo.status);
  }

  const changed: TodoItem[] = [];
  for (const todo of newTodos) {
    if (todo.status !== 'closed' && todo.status !== 'active') continue;
    const previous = previousStatusByContent.get(todo.content);
    if (previous === undefined || previous !== todo.status) changed.push(todo);
  }

  return changed.length > 0 ? changed : newTodos;
}
