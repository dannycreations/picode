import { describe, expect, it } from 'vitest';

import { getMostImportantTodo, getScrollIndex } from '@extension/structures/chat-session/todo';

describe('getScrollIndex', () => {
  it('should find in-progress todo first', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Pending 1', status: 'pending' as const },
      { content: 'Working', status: 'in_progress' as const },
      { content: 'Pending 2', status: 'pending' as const },
    ];
    expect(getScrollIndex(todos)).toBe(2);
  });

  it('should find first incomplete todo if none are in-progress', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Pending 1', status: 'pending' as const },
      { content: 'Pending 2', status: 'pending' as const },
    ];
    expect(getScrollIndex(todos)).toBe(1);
  });

  it('should return -1 if all are completed', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Done 2', status: 'completed' as const },
    ];
    expect(getScrollIndex(todos)).toBe(-1);
  });
});

describe('getMostImportantTodo', () => {
  it('should return in_progress todo if present', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Pending 1', status: 'pending' as const },
      { content: 'Working', status: 'in_progress' as const },
    ];
    expect(getMostImportantTodo(todos)).toEqual({ content: 'Working', status: 'in_progress' });
  });

  it('should return pending todo if no in_progress is present', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Pending 1', status: 'pending' as const },
    ];
    expect(getMostImportantTodo(todos)).toEqual({ content: 'Pending 1', status: 'pending' });
  });

  it('should return undefined if all are completed', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Done 2', status: 'completed' as const },
    ];
    expect(getMostImportantTodo(todos)).toBeUndefined();
  });
});
