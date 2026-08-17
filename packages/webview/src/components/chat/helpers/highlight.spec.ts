import { describe, expect, it } from 'vitest';

import { splitInputSegments } from './highlight';

import type { CommandItem } from '@pi-code/shared/core/protocol';

const COMMANDS: CommandItem[] = [
  { name: 'skill:pdf-form', source: 'skill', description: 'Fill PDF forms' },
  { name: 'skill:commit-helper', source: 'skill', description: 'Write commits' },
];

describe('splitInputSegments', () => {
  it('should highlight a leading command token', () => {
    expect(splitInputSegments('/skill:pdf-form fill it', COMMANDS)).toEqual([
      { text: '/skill:pdf-form', highlighted: true },
      { text: ' fill it', highlighted: false },
    ]);
  });

  it('should not highlight an unknown command', () => {
    expect(splitInputSegments('/nope fix it', COMMANDS).every((segment) => !segment.highlighted)).toBe(true);
  });

  it('should highlight a mention token anywhere in the text', () => {
    expect(splitInputSegments('see @src/index.ts please', COMMANDS)).toEqual([
      { text: 'see ', highlighted: false },
      { text: '@src/index.ts', highlighted: true },
      { text: ' please', highlighted: false },
    ]);
  });

  it('should highlight mentions at the start and in sequence', () => {
    expect(splitInputSegments('@src/a.ts @src/b.ts', COMMANDS)).toEqual([
      { text: '@src/a.ts', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/b.ts', highlighted: true },
    ]);
  });

  it('should highlight a command together with mentions', () => {
    expect(splitInputSegments('/skill:pdf-form @src/a.ts @src/b.ts', COMMANDS)).toEqual([
      { text: '/skill:pdf-form', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/a.ts', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '@src/b.ts', highlighted: true },
    ]);
  });

  it('should leave plain text unhighlighted', () => {
    expect(splitInputSegments('just text', COMMANDS)).toEqual([{ text: 'just text', highlighted: false }]);
  });
});
