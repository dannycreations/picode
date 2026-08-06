import { describe, expect, it } from 'vitest';

import { cleanCommandOutput } from '@extension/structures/tool-call/execute-command';

describe('cleanCommandOutput', () => {
  it('strips ANSI color and style escape codes', () => {
    const dirty = '\x1b[2m$ tsx scripts/build.ts\x1b[22m\n\x1b[36mvite v8.2.0\x1b[39m \x1b[32mbuilding\x1b[0m';
    expect(cleanCommandOutput(dirty)).toBe('$ tsx scripts/build.ts\nvite v8.2.0 building');
  });

  it('keeps only the final segment of carriage-return progress overwrites', () => {
    const dirty = 'transforming...\rrendering chunks...\rcomputing gzip size...';
    expect(cleanCommandOutput(dirty)).toBe('computing gzip size...');
  });

  it('collapses 3+ blank lines and trims surrounding whitespace', () => {
    const dirty = 'line one\n\n\n\n\n  line two  \n';
    expect(cleanCommandOutput(dirty)).toBe('line one\n\n  line two');
  });

  it('removes OSC window-title sequences', () => {
    const dirty = '\x1b]0;build running\x07done';
    expect(cleanCommandOutput(dirty)).toBe('done');
  });
});
