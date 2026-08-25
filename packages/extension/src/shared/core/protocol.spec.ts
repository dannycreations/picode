import { describe, expect, it } from 'vitest';

import { formatModelSelection, parseModelSelection } from '@pi-code/shared/core/protocol';

describe('model selection encoding', () => {
  it('round-trips provider and id', () => {
    const selection = { provider: 'openrouter', id: 'openai/gpt-4o' };
    expect(formatModelSelection(selection)).toBe('openrouter/openai/gpt-4o');
    expect(parseModelSelection(formatModelSelection(selection))).toEqual(selection);
  });

  it('rejects values without a usable provider/model split', () => {
    expect(parseModelSelection('')).toBeUndefined();
    expect(parseModelSelection('anthropic')).toBeUndefined();
    expect(parseModelSelection('/claude-sonnet-4')).toBeUndefined();
    expect(parseModelSelection('anthropic/')).toBeUndefined();
  });
});
