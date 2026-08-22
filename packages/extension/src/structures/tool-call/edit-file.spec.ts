import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';

const { stat, readFile, writeFile, mkdir, rename, unlink, open } = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(async () => 'original content'),
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
const READABLE = { isFile: () => true, size: 128 };

function execute(params: { file_path: string; old_string: string; new_string: string }) {
  return editFileTool.execute('test-id', params, undefined, undefined, { cwd: process.cwd() } as any) as Promise<any>;
}

describe('editFileTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stat.mockResolvedValue(OVERSIZED);
  });

  it('rejects editing an oversized existing file instead of loading it', async () => {
    const result = await execute({ file_path: 'big.txt', old_string: 'a', new_string: 'b' });

    expect(readFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('write_file');
  });

  it('refuses to overwrite an existing unreadable file when creating with an empty old_string', async () => {
    const result = await execute({ file_path: 'big.txt', old_string: '', new_string: 'replacement' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exceeds');
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('creates a missing file through the atomic write path', async () => {
    stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const result = await execute({ file_path: 'fresh.txt', old_string: '', new_string: 'created' });

    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(String(rename.mock.calls[0][1])).toContain('fresh.txt');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('created');
  });

  it('applies an exact replacement and writes atomically', async () => {
    stat.mockResolvedValue(READABLE);
    readFile.mockResolvedValue('original content');

    const result = await execute({ file_path: 'note.txt', old_string: 'content', new_string: 'CONTENT' });

    expect(readFile).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('CONTENT');
  });
});
