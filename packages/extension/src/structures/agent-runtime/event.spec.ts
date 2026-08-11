import { describe, expect, it } from 'vitest';

import { toolResultText } from '@pi-code/extension/structures/agent-runtime/event';

describe('toolResultText', () => {
  it('passes a plain string result through unchanged', () => {
    expect(toolResultText('done')).toBe('done');
  });

  it('extracts the text the model receives so live rows match a reloaded session', () => {
    const result = { content: [{ type: 'text', text: 'line one' }], details: { diff: 'ignored' } };

    expect(toolResultText(result)).toBe('line one');
  });

  it('joins every text part', () => {
    const result = {
      content: [
        { type: 'text', text: 'first' },
        { type: 'image', data: '...' },
        { type: 'text', text: 'second' },
      ],
    };

    expect(toolResultText(result)).toBe('first\nsecond');
  });

  it('falls back to the raw payload when no text part is present', () => {
    const result = { content: [{ type: 'image', data: 'abc' }] };

    expect(toolResultText(result)).toBe(JSON.stringify(result));
  });

  it('never returns undefined for an empty result', () => {
    expect(toolResultText(undefined)).toBe('');
  });
});
