import { describe, expect, it } from 'vitest';

import {
  containsIgnoreCase,
  countOccurrences,
  DEFAULT_CONTEXT_LIMIT,
  elapsedSeconds,
  findOccurrences,
  findReplaceableFailedRequest,
  hasVisibleOutput,
  parseTextAttachment,
  relativeToWorkspace,
  remainingSeconds,
  resolveContextLimit,
  splitOnOccurrences,
  startsWithIgnoringLeadingWhitespace,
} from './common';
import { wrapCodeBlock } from './markdown';

import type { ChatMessage } from '../core/types';

describe('parseTextAttachment', () => {
  // The writer and the reader must agree on the fence grammar, otherwise a
  // reloaded session silently loses the attachment it stored.
  it.each([
    ['plain body', 'ts'],
    ['multi\nline\nbody', 'markdown'],
    ['```js\nconst a = 1;\n```', 'ts'],
    ['trailing fence\n```', 'ts'],
  ])('round-trips a body written by wrapCodeBlock', (body, language) => {
    expect(parseTextAttachment(wrapCodeBlock(body, language))).toEqual({ kind: 'text', content: body, language });
  });

  it('omits the language when the writer was given none', () => {
    expect(parseTextAttachment(wrapCodeBlock('plain body'))).toEqual({ kind: 'text', content: 'plain body' });
  });

  it('returns null for content that is not a fenced block', () => {
    expect(parseTextAttachment('just text')).toBeNull();
    expect(parseTextAttachment('```ts\nunterminated')).toBeNull();
    expect(parseTextAttachment(undefined)).toBeNull();
  });
});

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

describe('elapsedSeconds', () => {
  it('rounds a millisecond span to whole seconds', () => {
    expect(elapsedSeconds(0, 1499)).toBe(1);
    expect(elapsedSeconds(0, 1500)).toBe(2);
  });

  it('clamps a negative span to zero', () => {
    expect(elapsedSeconds(1000, 0)).toBe(0);
  });
});

describe('remainingSeconds', () => {
  it('rounds a millisecond wait up to whole seconds', () => {
    expect(remainingSeconds(2500, 0)).toBe(3);
    expect(remainingSeconds(2000, 0)).toBe(2);
  });

  it('clamps a passed deadline to zero', () => {
    expect(remainingSeconds(0, 1000)).toBe(0);
  });
});

describe('resolveContextLimit', () => {
  it('uses the reported window when present', () => {
    expect(resolveContextLimit(40_000)).toBe(40_000);
  });

  it('falls back to the shared default budget', () => {
    expect(resolveContextLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('findReplaceableFailedRequest', () => {
  const failed = (id: string): ChatMessage => ({
    id,
    sender: 'api_request',
    text: 'API Request',
    timestamp: 1,
    toolStatus: 'denied',
    errorMessage: 'overloaded',
  });

  it('returns undefined with no messages', () => {
    expect(findReplaceableFailedRequest([])).toBeUndefined();
  });

  it('returns the failed request when only an empty assistant reply follows it', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'a1', sender: 'assistant', text: '', timestamp: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBe(0);
  });

  it('returns undefined once visible assistant output follows the failure', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'a1', sender: 'assistant', text: 'partial answer', timestamp: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('returns undefined when the trailing request did not fail', () => {
    const messages: ChatMessage[] = [{ id: 'r1', sender: 'api_request', text: 'API Request', timestamp: 1, toolStatus: 'completed' }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('stops at an error notice so fatal errors stay visible', () => {
    const messages: ChatMessage[] = [failed('r1'), { id: 'e1', sender: 'error', text: 'fatal', timestamp: 2 }];
    expect(findReplaceableFailedRequest(messages)).toBeUndefined();
  });

  it('skips empty attempts back to the start of the failure chain', () => {
    const messages: ChatMessage[] = [
      failed('r1'),
      { id: 'a1', sender: 'assistant', text: '', timestamp: 2 },
      failed('r2'),
      { id: 'a2', sender: 'assistant', text: '', reasoning: '   ', timestamp: 3 },
    ];
    expect(findReplaceableFailedRequest(messages)).toBe(0);
  });

  it('collapses the chain even when a tool call precedes it', () => {
    const messages: ChatMessage[] = [
      { id: 't1', sender: 'tool', text: 'read_file', timestamp: 1 },
      failed('r1'),
      { id: 'a1', sender: 'assistant', text: '', timestamp: 2 },
    ];
    expect(findReplaceableFailedRequest(messages)).toBe(1);
  });
});

describe('relativeToWorkspace', () => {
  it('returns the path unchanged when no workspace root is known', () => {
    expect(relativeToWorkspace('c:/abc/def/ghi/tes.txt', '')).toBe('c:/abc/def/ghi/tes.txt');
  });

  it('strips the workspace root to a relative label', () => {
    expect(relativeToWorkspace('c:/abc/def/ghi/tes.txt', 'c:/abc/def')).toBe('ghi/tes.txt');
  });

  it('accepts a trailing slash on the workspace root', () => {
    expect(relativeToWorkspace('c:/abc/def/ghi/tes.txt', 'c:/abc/def/')).toBe('ghi/tes.txt');
  });

  it('normalizes backslash roots and paths', () => {
    expect(relativeToWorkspace('c:\\abc\\def\\ghi\\tes.txt', 'c:\\abc\\def')).toBe('ghi/tes.txt');
  });

  it('matches a Windows drive letter regardless of case', () => {
    expect(relativeToWorkspace('C:/abc/def/ghi/tes.txt', 'c:/abc/def')).toBe('ghi/tes.txt');
  });

  it('leaves POSIX paths that differ only by case untouched', () => {
    expect(relativeToWorkspace('/home/user/Project/file.ts', '/home/user/project')).toBe('/home/user/Project/file.ts');
  });

  it('leaves paths outside the workspace untouched', () => {
    expect(relativeToWorkspace('c:/abc/other/file.ts', 'c:/abc/def')).toBe('c:/abc/other/file.ts');
  });
});

describe('findOccurrences', () => {
  it('finds every occurrence of a literal needle', () => {
    expect(findOccurrences('a cat and a cat', 'cat')).toEqual([2, 12]);
  });

  it('treats the needle as a literal, not a pattern', () => {
    expect(findOccurrences('a.b and axb', '.')).toEqual([1]);
  });

  it('ignores case unless the caller asks otherwise', () => {
    expect(findOccurrences('Foo bar FOO', 'foo')).toEqual([0, 8]);
    expect(findOccurrences('Foo bar FOO', 'foo', true)).toEqual([]);
  });

  it('reuses the compiled pattern across calls', () => {
    // The pattern is cached, so a second scan must not pick up the position
    // the first one stopped at.
    expect(findOccurrences('cat cat', 'cat')).toEqual([0, 4]);
    expect(findOccurrences('cat cat', 'cat')).toEqual([0, 4]);
  });

  it('counts the occurrences without building the list', () => {
    expect(countOccurrences('a cat and a cat', 'cat')).toBe(2);
    expect(countOccurrences('a cat and a cat', 'dog')).toBe(0);
  });
});

describe('containsIgnoreCase', () => {
  it('finds a needle regardless of case', () => {
    expect(containsIgnoreCase('src/Alpha.ts', 'alpha')).toBe(true);
    expect(containsIgnoreCase('src/Alpha.ts', 'beta')).toBe(false);
  });

  it('treats the needle as a literal', () => {
    expect(containsIgnoreCase('a.b', '.')).toBe(true);
    expect(containsIgnoreCase('axb', '.')).toBe(false);
  });

  it('matches everything for an empty needle', () => {
    expect(containsIgnoreCase('anything', '')).toBe(true);
  });
});

describe('hasVisibleOutput', () => {
  it('accepts text with content', () => {
    expect(hasVisibleOutput({ id: 'a', sender: 'assistant', text: 'H', timestamp: 1 })).toBe(true);
  });

  it('rejects text that is only whitespace', () => {
    expect(hasVisibleOutput({ id: 'a', sender: 'assistant', text: '  \n\t ', timestamp: 1 })).toBe(false);
    expect(hasVisibleOutput({ id: 'a', sender: 'assistant', text: '', timestamp: 1, reasoning: '   ' })).toBe(false);
  });

  it('accepts reasoning on its own', () => {
    expect(hasVisibleOutput({ id: 'a', sender: 'assistant', text: '', timestamp: 1, reasoning: 'thinking' })).toBe(true);
  });
});

describe('startsWithIgnoringLeadingWhitespace', () => {
  it('skips the leading whitespace', () => {
    expect(startsWithIgnoringLeadingWhitespace('  \n## Heading', '## Heading')).toBe(true);
    expect(startsWithIgnoringLeadingWhitespace('## Heading', '## Heading')).toBe(true);
  });

  it('rejects a different prefix', () => {
    expect(startsWithIgnoringLeadingWhitespace('  # Heading', '## Heading')).toBe(false);
    expect(startsWithIgnoringLeadingWhitespace('', '## Heading')).toBe(false);
  });
});
