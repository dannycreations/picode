import { describe, expect, it } from 'vitest';

import { getScrollIndex, getVisibleTodos } from '@pi-code/shared/utilities/todo';

import type { TodoItem } from '@pi-code/shared/utilities/todo';

describe('getScrollIndex', () => {
  it('should find active todo first', () => {
    const todos = [
      { content: 'Done 1', status: 'closed' as const },
      { content: 'Pending 1', status: 'open' as const },
      { content: 'Working', status: 'active' as const },
      { content: 'Pending 2', status: 'open' as const },
    ];
    expect(getScrollIndex(todos)).toBe(2);
  });

  it('should find first incomplete todo if none are active', () => {
    const todos = [
      { content: 'Done 1', status: 'closed' as const },
      { content: 'Pending 1', status: 'open' as const },
      { content: 'Pending 2', status: 'open' as const },
    ];
    expect(getScrollIndex(todos)).toBe(1);
  });

  it('should return -1 if all are closed', () => {
    const todos = [
      { content: 'Done 1', status: 'closed' as const },
      { content: 'Done 2', status: 'closed' as const },
    ];
    expect(getScrollIndex(todos)).toBe(-1);
  });
});

describe('getVisibleTodos', () => {
  const list: TodoItem[] = [
    { content: 'one', status: 'closed' },
    { content: 'two', status: 'active' },
    { content: 'three', status: 'open' },
  ];

  it('should show the whole list for the first update of a task', () => {
    expect(getVisibleTodos([], list)).toEqual(list);
  });

  it('should show the whole list when the update changed nothing', () => {
    // A step that re-sends an identical checklist has no diff to report, so it
    // renders the checklist rather than an empty body.
    expect(getVisibleTodos(list, [...list])).toEqual(list);
  });

  it('should show only the items that started or finished', () => {
    const next: TodoItem[] = [
      { content: 'one', status: 'active' },
      { content: 'two', status: 'active' },
      { content: 'three', status: 'open' },
      { content: 'four', status: 'active' },
    ];
    expect(getVisibleTodos(list, next)).toEqual([
      { content: 'one', status: 'active' },
      { content: 'four', status: 'active' },
    ]);
  });

  it('should render nothing when the checklist is emptied', () => {
    expect(getVisibleTodos(list, [])).toEqual([]);
  });
});
