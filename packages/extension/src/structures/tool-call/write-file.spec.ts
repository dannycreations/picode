import { describe, expect, it, vi } from 'vitest';

import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';

const { stat, readFile, writeFile, mkdir } = vi.hoisted(() => ({
  stat: vi.fn(async () => ({ isFile: () => true, size: 20 * 1024 * 1024 })),
  readFile: vi.fn(async () => 'previous content'),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => {
        if (key === 'maxToolOutputLines') return 2000;
        if (key === 'maxToolOutputSizeKb') return 50;
        return undefined;
      },
    }),
  },
}));

vi.mock('node:fs/promises', () => ({ stat, readFile, writeFile, mkdir }));

describe('writeFileTool', () => {
  it('does not load an oversized existing file just to build a diff', async () => {
    const result = (await writeFileTool.execute('test-id', { path: 'big.txt', content: 'new content' }, undefined, undefined, {
      cwd: process.cwd(),
    } as any)) as any;

    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });
});
