import { describe, expect, it } from 'vitest';

import { getScrollIndex } from '@pi-code/shared/utilities/todo';

describe('getScrollIndex', () => {
  it('should find in-progress todo first', () => {
    const todos = [
      { content: 'Done 1', status: 'completed' as const },
      { content: 'Pending 1', status: 'pending' as const },
      { content: 'Working', status: 'progress' as const },
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
