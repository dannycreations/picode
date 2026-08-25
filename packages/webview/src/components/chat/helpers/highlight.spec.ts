import { describe, expect, it } from 'vitest';

import { splitTokenSegments } from './highlight';

import type { CommandItem } from '@pi-code/shared/core/protocol';

const COMMANDS: CommandItem[] = [
  { name: 'skill:pdf-form', source: 'skill', description: 'Fill PDF forms' },
  { name: 'skill:commit-helper', source: 'skill', description: 'Write commits' },
];

describe('splitTokenSegments', () => {
  it('should highlight a leading command token', () => {
    expect(splitTokenSegments('/skill:pdf-form fill it', COMMANDS)).toEqual([
      { text: '/skill:pdf-form', highlighted: true },
      { text: ' fill it', highlighted: false },
    ]);
  });

  it('should not highlight an unknown command', () => {
    expect(splitTokenSegments('/nope fix it', COMMANDS).every((segment) => !segment.highlighted)).toBe(true);
  });

  it('should highlight a mention token anywhere in the text', () => {
    expect(splitTokenSegments('see @src/index.ts please', COMMANDS)).toEqual([
      { text: 'see ', highlighted: false },
      { text: '@src/index.ts', highlighted: true },
      { text: ' please', highlighted: false },
    ]);
  });

  it('should highlight mentions at the start and in sequence', () => {
    expect(splitTokenSegments('@src/a.ts @src/b.ts', COMMANDS)).toEqual([
      { text: '@src/a.ts', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/b.ts', highlighted: true },
    ]);
  });

  it('should highlight a command together with mentions', () => {
    expect(splitTokenSegments('/skill:pdf-form @src/a.ts @src/b.ts', COMMANDS)).toEqual([
      { text: '/skill:pdf-form', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/a.ts', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/b.ts', highlighted: true },
    ]);
  });

  it('should highlight a hash-like tag token', () => {
    expect(splitTokenSegments('ship #4e7c64a now', COMMANDS)).toEqual([
      { text: 'ship ', highlighted: false },
      { text: '#4e7c64a', highlighted: true },
      { text: ' now', highlighted: false },
    ]);
  });

  it('should highlight the working changes tag on its own', () => {
    expect(splitTokenSegments('#changes', COMMANDS)).toEqual([{ text: '#changes', highlighted: true }]);
  });

  it('should keep a word tag that resolves to nothing plain', () => {
    expect(splitTokenSegments('#todo fix later', COMMANDS)).toEqual([{ text: '#todo fix later', highlighted: false }]);
  });

  it('should reject hashes shorter than seven characters', () => {
    expect(splitTokenSegments('#abcdef nope', COMMANDS)).toEqual([{ text: '#abcdef nope', highlighted: false }]);
  });

  it('should accept a full-length hash tag', () => {
    const full = `#${'a'.repeat(40)}`;
    expect(splitTokenSegments(full, COMMANDS)).toEqual([{ text: full, highlighted: true }]);
  });

  it('should highlight a tag next to a mention', () => {
    expect(splitTokenSegments('@src/a.ts #changes', COMMANDS)).toEqual([
      { text: '@src/a.ts', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '#changes', highlighted: true },
    ]);
  });

  it('should keep a # inside a mention as part of the mention', () => {
    expect(splitTokenSegments('@a#b c', COMMANDS)).toEqual([
      { text: '@a#b', highlighted: true },
      { text: ' c', highlighted: false },
    ]);
  });

  it('should not highlight a # glued to a word', () => {
    expect(splitTokenSegments('issue#123 stays plain', COMMANDS)).toEqual([{ text: 'issue#123 stays plain', highlighted: false }]);
  });

  it('should leave plain text unhighlighted', () => {
    expect(splitTokenSegments('just text', COMMANDS)).toEqual([{ text: 'just text', highlighted: false }]);
  });
});
