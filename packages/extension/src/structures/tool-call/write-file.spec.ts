import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';

const { stat, readFile, writeFile, mkdir, rename, unlink, open } = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(async () => 'previous content'),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  rename: vi.fn(async (_from: string, _to: string) => undefined),
  unlink: vi.fn(async () => undefined),
  open: vi.fn(async () => ({
    read: async () => ({ bytesRead: 0 }),
    close: async () => {},
  })),
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

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat, readFile, writeFile, mkdir, rename, unlink, open };
});

const OVERSIZED = { isFile: () => true, size: 20 * 1024 * 1024 };

function execute(params: { path: string; content: string }) {
  return writeFileTool.execute('test-id', params, undefined, undefined, { cwd: process.cwd() } as any) as Promise<any>;
}

describe('writeFileTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stat.mockResolvedValue(OVERSIZED);
  });

  it('does not load an oversized existing file just to build a diff', async () => {
    const result = await execute({ path: 'big.txt', content: 'new content' });

    expect(readFile).not.toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
  });

  it('writes through a temp file renamed over the target', async () => {
    const result = await execute({ path: 'out.txt', content: 'body' });

    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(String(rename.mock.calls[0][1])).toContain('out.txt');
    expect(unlink).not.toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
    expect(String(result.content[0].text)).toContain('body');
  });
});
