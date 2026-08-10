import { describe, expect, it, vi } from 'vitest';

import { getIgnoredPaths } from '@pi-code/extension/utilities/git';

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
