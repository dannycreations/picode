import { describe, expect, it } from 'vitest';

import { formatDuration, resolveThinkingLevel } from '@pi-code/webview/utilities/common';

describe('formatDuration', () => {
  it('formats elapsed time as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(599)).toBe('09:59');
    expect(formatDuration(-3)).toBe('00:00');
  });
});

describe('resolveThinkingLevel', () => {
  const levels = ['off', 'low', 'medium'] as const;

  it('keeps the preferred level while the model supports it', () => {
    expect(resolveThinkingLevel(levels, 'low')).toBe('low');
  });

  it('falls back when the preferred level is unsupported or absent', () => {
    expect(resolveThinkingLevel(levels, 'high')).toBe('medium');
    expect(resolveThinkingLevel(levels, null)).toBe('medium');
  });

  it('falls back to the first level when only "off" exists', () => {
    expect(resolveThinkingLevel(['off'] as const, null)).toBe('off');
  });

  it('returns null for a model without thinking levels', () => {
    expect(resolveThinkingLevel([], null)).toBeNull();
  });
});
