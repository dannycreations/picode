import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteFileTool } from '@pi-code/extension/structures/tool-call/delete-file';

const { stat, rm, unlink } = vi.hoisted(() => ({
  stat: vi.fn(),
  rm: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat, rm, unlink };
});

function execute(path: string) {
  return deleteFileTool.execute('test-id', { path }, undefined, undefined, { cwd: process.cwd() } as any) as Promise<any>;
}

describe('deleteFileTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
  });

  it('refuses to delete the workspace root itself', async () => {
    const result = await execute('.');

    expect(rm).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('workspace root');
  });

  it('refuses to delete a parent directory that contains the workspace', async () => {
    const result = await execute('..');

    expect(rm).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('workspace root');
  });

  it('deletes directories recursively', async () => {
    stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false });

    const result = await execute('build/output');

    expect(rm).toHaveBeenCalledWith(expect.stringContaining('output'), { recursive: true, force: true });
    expect(result.content[0].text).toContain('Deleted directory: build/output');
  });

  it('deletes single files with unlink', async () => {
    const result = await execute('notes.txt');

    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('notes.txt'));
    expect(rm).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Deleted file: notes.txt');
  });

  it('reports a missing target as a tool error', async () => {
    stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const result = await execute('gone.txt');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('does not exist');
  });
});
