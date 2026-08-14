import { describe, expect, it } from 'vitest';

import { formatDuration } from '@pi-code/webview/utilities/common';

describe('formatDuration', () => {
  it('formats elapsed time as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(599)).toBe('09:59');
    expect(formatDuration(-3)).toBe('00:00');
  });
});
