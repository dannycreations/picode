import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execGit, getIgnoredPaths } from '@pi-code/extension/utilities/git';

import type { Repository } from '@pi-code/extension/types/git';

function fakeRepo(checkIgnore: (paths: string[]) => Promise<Set<string>>): Repository {
  return { checkIgnore } as unknown as Repository;
}

describe('getIgnoredPaths', () => {
  it('returns the ignored subset reported by the repository', async () => {
    const repo = fakeRepo(async (paths) => new Set(paths.filter((p) => p.endsWith('.log'))));

    const ignored = await getIgnoredPaths(repo, ['a.ts', 'b.log', 'c.log']);

    expect(ignored).toEqual(new Set(['b.log', 'c.log']));
  });

  it('returns an empty set for no input without calling git', async () => {
    const checkIgnore = vi.fn();
    const repo = fakeRepo(checkIgnore);

    expect(await getIgnoredPaths(repo, [])).toEqual(new Set());
    expect(checkIgnore).not.toHaveBeenCalled();
  });

  it('treats a failing check as "nothing ignored"', async () => {
    const repo = fakeRepo(async () => {
      throw new Error('boom');
    });

    expect(await getIgnoredPaths(repo, ['a.ts'])).toEqual(new Set());
  });
});

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'pi-code-git-cli-'));
  await execGit(repo, ['init']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('execGit', () => {
  it('returns the standard output of the command', async () => {
    const output = await execGit(repo, ['rev-parse', '--is-inside-work-tree']);

    expect(output.trim()).toBe('true');
  });

  it('rejects when the command fails', async () => {
    await expect(execGit(repo, ['rev-parse', '--verify', 'refs/heads/missing-branch'])).rejects.toThrow();
  });

  it('runs the command with the given environment', async () => {
    const output = await execGit(repo, ['var', 'GIT_AUTHOR_IDENT'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'Pi Code', GIT_AUTHOR_EMAIL: 'pi-code@local' },
    });

    expect(output).toContain('Pi Code <pi-code@local>');
  });
});
