import { describe, expect, it } from 'vitest';

import { getScrollIndex } from '@pi-code/shared/utilities/todo';

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
