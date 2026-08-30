import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAppSettings } from '@pi-code/extension/core/settings';
import { cleanCommandOutput, executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';

// Settings are memoized, so tests write raw VS Code values into this record and
// invalidate the snapshot afterwards to pick up their changes.
const configValues = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => configValues[key],
      }),
    },
  };
});

beforeEach(() => {
  configValues['maxToolOutputLines'] = 2000;
  configValues['maxToolOutputSizeKb'] = 50;
});

afterEach(() => {
  for (const key of Object.keys(configValues)) delete configValues[key];
  invalidateAppSettings();
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

describe('executeCommandTool cancellation', () => {
  it('kills the process tree and settles when the task is canceled', async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 50);

    const result = (await executeCommandTool.execute('test-id', { command: 'node -e "setInterval(() => {}, 5000)"' }, controller.signal, undefined, {
      cwd: process.cwd(),
    } as any)) as any;

    // Generous ceiling: the kill lands in milliseconds locally, but process
    // spawn plus tree-kill slows down on a heavily loaded CI machine.
    expect(Date.now() - startedAt).toBeLessThan(9000);
    expect(result.details.timedOut).toBe(false);
    expect(result.isError).toBe(true);
  }, 20_000);

  it('escalates to SIGKILL so commands that ignore SIGTERM still settle', async () => {
    const result = (await executeCommandTool.execute(
      'test-id',
      { command: `node -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 5000)"`, timeout: 30 },
      undefined,
      undefined,
      { cwd: process.cwd() } as any,
    )) as any;

    expect(result.details.timedOut).toBe(true);
  }, 20_000);
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
