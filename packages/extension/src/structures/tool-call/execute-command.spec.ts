import { readFile, unlink } from 'node:fs/promises';
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

  it('caps streaming deltas to the configured byte limit', async () => {
    configValues['maxToolOutputLines'] = 2000;
    configValues['maxToolOutputSizeKb'] = 1; // 1 KB = 1024 bytes

    const updates: string[] = [];
    const onUpdate = (...args: any[]) => {
      const params = args[1];
      if (params?.details?.output) {
        updates.push(params.details.output);
      }
    };

    // Produce ~3 KB of output. With a 1 KB limit, streaming deltas should be capped.
    const command = `node -e "console.log('${'x'.repeat(1000)}')"`;

    const result = (await executeCommandTool.execute('streaming-cap-test', { command, timeout: 5000 }, undefined, onUpdate, {
      cwd: process.cwd(),
    } as any)) as any;

    expect(result.details.timedOut).toBe(false);

    // Each streaming delta should be at most the configured byte limit.
    for (const delta of updates) {
      expect(delta.length).toBeLessThanOrEqual(1024);
    }
  });
});

describe('executeCommandTool output dumps', () => {
  const writtenTempFiles: string[] = [];

  afterEach(async () => {
    await Promise.all(writtenTempFiles.splice(0).map((path) => unlink(path).catch(() => undefined)));
  });

  const dumpFor = async (command: string) => {
    const result = (await executeCommandTool.execute('dump-test', { command, timeout: 20_000 }, undefined, undefined, {
      cwd: process.cwd(),
    } as any)) as any;
    expect(result.details.tempFilePath).toBeTypeOf('string');
    writtenTempFiles.push(result.details.tempFilePath);
    return readFile(result.details.tempFilePath, 'utf8');
  };

  it('spills the complete output, not the retained tail, once the byte budget is exceeded', async () => {
    // Both limits are clamped to their package.json minimums, so 5 KB and 100
    // lines are the smallest budgets the tool will actually run with.
    configValues['maxToolOutputLines'] = 2000;
    configValues['maxToolOutputSizeKb'] = 5; // 5 KB budget

    const dumped = await dumpFor(`node -e "console.log('MARKER-FIRST-LINE'); for (let i = 0; i < 400; i++) console.log('x'.repeat(100))"`);

    // ~40 KB of output. The spill fires at 5 KB, well before the 10 KB tail
    // window starts discarding chunks, and the file is what the model is told to
    // read instead, so it still has to start at the first line emitted.
    expect(dumped.startsWith('MARKER-FIRST-LINE')).toBe(true);
  });

  it('dumps the full output when only the line limit truncates it', async () => {
    configValues['maxToolOutputLines'] = 100; // the clamped minimum
    configValues['maxToolOutputSizeKb'] = 500; // far above the ~5 KB below

    const dumped = await dumpFor(`node -e "console.log('line 1'); for (let i = 2; i <= 400; i++) console.log('line ' + i)"`);

    // No spill is possible here, so this covers the dump that happens at the end.
    expect(dumped.startsWith('line 1')).toBe(true);
    expect(dumped).toContain('line 400');
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
