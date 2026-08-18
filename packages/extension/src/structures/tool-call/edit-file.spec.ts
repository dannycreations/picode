import { describe, expect, it, vi } from 'vitest';

import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';

const { stat, readFile, writeFile, mkdir } = vi.hoisted(() => ({
  stat: vi.fn(async () => ({ isFile: () => true, size: 20 * 1024 * 1024 })),
  readFile: vi.fn(async () => 'original content'),
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

describe('editFileTool', () => {
  it('rejects editing an oversized existing file instead of loading it', async () => {
    const result = (await editFileTool.execute('test-id', { file_path: 'big.txt', old_string: 'a', new_string: 'b' }, undefined, undefined, {
      cwd: process.cwd(),
    } as any)) as any;

    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('write_file');
  });
});
