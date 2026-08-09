import { describe, expect, it } from 'vitest';

import { getScrollIndex, parseTodoList } from '@pi-code/shared/utilities/todo';

describe('parseTodoList', () => {
  it('should map checkbox indicators to statuses', () => {
    const todos = parseTodoList('- [x] Done\n- [~] Blocked\n- [-] Paused\n- [ ] Next');
    expect(todos).toEqual([
      { content: 'Done', status: 'completed' },
      { content: 'Blocked', status: 'in_progress' },
      { content: 'Paused', status: 'in_progress' },
      { content: 'Next', status: 'pending' },
    ]);
  });

  it('should ignore lines that are not todo entries', () => {
    const todos = parseTodoList('just text\n# Heading\n- [x] Valid');
    expect(todos).toEqual([{ content: 'Valid', status: 'completed' }]);
  });
});

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
