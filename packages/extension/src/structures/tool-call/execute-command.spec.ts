import { describe, expect, it, vi } from 'vitest';

import { cleanCommandOutput, executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => {
          if (key === 'maxToolOutputLines') return 2000;
          if (key === 'maxToolOutputSizeKb') return 50;
          return undefined;
        },
      }),
    },
  };
});

describe('executeCommandTool', () => {
  it('respects requested timeout', async () => {
    const result = (await executeCommandTool.execute(
      'test-id',
      { command: 'node -e "setTimeout(() => {}, 5000)"', timeout: 50 },
      undefined,
      undefined,
      { cwd: process.cwd() } as any,
    )) as any;
    expect(result.details.timedOut).toBe(true);
  });
});

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
