import { describe, expect, it } from 'vitest';

import { resolveContextLimit, splitOnOccurrences } from './common';

describe('splitOnOccurrences', () => {
  it('returns one unmatched segment when nothing matches', () => {
    expect(splitOnOccurrences('abc', 'x')).toEqual([{ text: 'abc', matchIndex: null }]);
  });

  it('returns the whole text as a single match', () => {
    expect(splitOnOccurrences('@foo', '@foo')).toEqual([{ text: '@foo', matchIndex: 0 }]);
  });

  it('interleaves plain and matched segments with ordinals', () => {
    expect(splitOnOccurrences('a cat and a cat', 'cat')).toEqual([
      { text: 'a ', matchIndex: null },
      { text: 'cat', matchIndex: 0 },
      { text: ' and a ', matchIndex: null },
      { text: 'cat', matchIndex: 1 },
    ]);
  });

  it('matches case-insensitively by default but keeps the original casing', () => {
    expect(splitOnOccurrences('Foo bar FOO', 'foo')).toEqual([
      { text: 'Foo', matchIndex: 0 },
      { text: ' bar ', matchIndex: null },
      { text: 'FOO', matchIndex: 1 },
    ]);
  });

  it('handles adjacent matches without empty gaps', () => {
    expect(splitOnOccurrences('aa', 'a')).toEqual([
      { text: 'a', matchIndex: 0 },
      { text: 'a', matchIndex: 1 },
    ]);
  });

  it('treats an empty needle as no match', () => {
    expect(splitOnOccurrences('abc', '')).toEqual([{ text: 'abc', matchIndex: null }]);
  });
});

describe('resolveContextLimit', () => {
  it('uses the reported window when present', () => {
    expect(resolveContextLimit(40_000)).toBe(40_000);
  });

  it('falls back to the shared default budget', () => {
    expect(resolveContextLimit(undefined)).toBe(200_000);
  });
});
