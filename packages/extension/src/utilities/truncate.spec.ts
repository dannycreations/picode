import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { shareOutputLimits, toOutputLimits, truncateOutput } from '@pi-code/extension/utilities/truncate';
import { DEFAULT_SETTINGS } from '@pi-code/shared/core/settings';

import type { AppSettings } from '@pi-code/shared/core/settings';

const limits = { maxLines: 5, maxBytes: 1024 };

function buildLines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join('\n');
}

describe('toOutputLimits', () => {
  it('converts the kilobyte setting into a byte budget', () => {
    const settings = { maxToolOutputLines: 1500, maxToolOutputSizeKb: 32 } as AppSettings;
    expect(toOutputLimits(settings)).toEqual({ maxLines: 1500, maxBytes: 32 * 1024 });
  });

  it('matches the pi defaults out of the box', () => {
    expect(toOutputLimits(DEFAULT_SETTINGS)).toEqual({ maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  });
});

describe('shareOutputLimits', () => {
  it('keeps the full budget for a single result', () => {
    expect(shareOutputLimits(limits, 1)).toBe(limits);
  });

  it('splits the budget across a batch', () => {
    expect(shareOutputLimits({ maxLines: 2000, maxBytes: 51200 }, 4)).toEqual({ maxLines: 500, maxBytes: 12800 });
  });

  it('never drops below one line or one kilobyte', () => {
    expect(shareOutputLimits({ maxLines: 2, maxBytes: 2048 }, 100)).toEqual({ maxLines: 1, maxBytes: 1024 });
  });
});

describe('truncateOutput', () => {
  it('returns content untouched when it fits the budget', () => {
    const content = buildLines(3);
    const { text, truncation } = truncateOutput(content, { limits });

    expect(text).toBe(content);
    expect(truncation.truncated).toBe(false);
  });

  it('keeps the first lines and appends a notice when truncating the head', () => {
    const { text, truncation } = truncateOutput(buildLines(10), { limits, keep: 'head' });

    expect(truncation.truncated).toBe(true);
    expect(truncation.truncatedBy).toBe('lines');
    expect(text).toContain('line1');
    expect(text).toContain('line5');
    expect(text).not.toContain('line6');
    expect(text).toContain('[Truncated: showing the first 5 of 10 lines (5 line output limit).]');
  });

  it('keeps the last lines and appends a notice when truncating the tail', () => {
    const { text } = truncateOutput(buildLines(10), { limits, keep: 'tail' });

    expect(text).toContain('line10');
    expect(text).not.toContain('line5\n');
    expect(text).toContain('[Truncated: showing the last 5 of 10 lines (5 line output limit).]');
  });

  it('reports the byte limit when size is the binding constraint', () => {
    const content = buildLines(4, 'x'.repeat(200));
    const { text, truncation } = truncateOutput(content, { limits: { maxLines: 100, maxBytes: 512 } });

    expect(truncation.truncatedBy).toBe('bytes');
    expect(text).toMatch(/\[Truncated: showing the first \d+ of 4 lines \(.+ output limit\)\.\]/);
  });

  it('appends the actionable hint to the notice', () => {
    const { text } = truncateOutput(buildLines(10), { limits, hint: 'Use line_ranges to continue.' });

    expect(text).toContain('(5 line output limit). Use line_ranges to continue.]');
  });

  it('derives the hint from the retained content', () => {
    const numbered = Array.from({ length: 10 }, (_, i) => `${i + 1}|content`).join('\n');
    const { text } = truncateOutput(numbered, {
      limits,
      hint: (truncation) => `Retained ${truncation.outputLines} lines.`,
    });

    expect(text).toContain('Retained 5 lines.]');
  });

  it('emits only the notice when the first line alone busts the byte budget', () => {
    const { text, truncation } = truncateOutput(`${'x'.repeat(500)}\nsecond`, { limits: { maxLines: 10, maxBytes: 100 } });

    expect(truncation.firstLineExceedsLimit).toBe(true);
    expect(text).toBe('[Truncated: the first line on its own exceeds the 100B output limit, so no content could be shown.]');
  });
});
