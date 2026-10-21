import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGitRoot } from '@pi-code/extension/utilities/git';
import { createIsolatedWorktree, integrateIsolatedWorktree, removeWorktreeDirectory, withWorktreeLock } from '@pi-code/extension/utilities/worktree';
import { logger } from '@pi-code/shared/core/logger';

import type { IsolatedWorktree } from '@pi-code/extension/utilities/worktree';

const execFileAsync = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Pi Code',
  GIT_AUTHOR_EMAIL: 'pi-code@local',
  GIT_COMMITTER_NAME: 'Pi Code',
  GIT_COMMITTER_EMAIL: 'pi-code@local',
};

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    env: GIT_ENV,
  });
  return stdout;
}

// Git reports repository paths with forward slashes and may resolve symlinked
// temporary directories, so compare canonical forms rather than raw strings.
async function canonical(path: string): Promise<string> {
  const resolved = await realpath(path).catch(() => path);
  const unified = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

let repo: string | undefined;
let created: string[];
let errors: string[];

// The identity travels through the environment, so the fixture never depends
// on the machine-level git configuration.
async function baseRepo(): Promise<string> {
  if (repo) return repo;
  const dir = await mkdtemp(join(tmpdir(), 'pi-code-wt-repo-'));
  await git(dir, ['init']);
  repo = dir;
  return dir;
}

async function commitAll(message: string): Promise<void> {
  const base = await baseRepo();
  await git(base, ['add', '-A']);
  await git(base, ['commit', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', message]);
}

async function expectWorktree(base: string): Promise<IsolatedWorktree> {
  const worktree = await createIsolatedWorktree(base);
  if (!worktree) throw new Error('expected an isolated worktree to be created');
  created.push(worktree.path);
  return worktree;
}

beforeEach(() => {
  repo = undefined;
  created = [];
  errors = [];
  logger.setSink({
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => errors.push(String(message)),
  });
});

afterEach(async () => {
  logger.setSink(null);
  for (const path of created) {
    await rm(path, { recursive: true, force: true });
  }
  created = [];
  if (repo) {
    await rm(repo, { recursive: true, force: true });
    repo = undefined;
  }
});

describe('withWorktreeLock', () => {
  it('runs queued callbacks one at a time instead of overlapping them', async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;

    const job = (id: string) =>
      withWorktreeLock(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(`${id}:start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`${id}:end`);
        active -= 1;
      });

    await Promise.all([job('a'), job('b'), job('c')]);

    // Two worktrees cannot be manipulated at the same time, so the lock has to
    // serialize the whole batch rather than just the first entry.
    expect(peak).toBe(1);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('keeps draining the queue after a callback rejects', async () => {
    const failing = withWorktreeLock(async () => {
      throw new Error('boom');
    });
    const following = withWorktreeLock(async () => 'still running');

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('still running');
  });

  it('resolves with the value produced by the callback', async () => {
    await expect(withWorktreeLock(async () => 'done')).resolves.toBe('done');
  });
});

describe('getGitRoot', () => {
  it('resolves the repository root that owns the given directory', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'file.txt'), 'content\n');
    await commitAll('initial');

    const nested = join(base, 'packages', 'extension');
    await mkdir(nested, { recursive: true });

    const root = await getGitRoot(nested);

    expect(root).not.toBeNull();
    expect(await canonical(root as string)).toBe(await canonical(base));
  });

  it('returns null for a directory outside any repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'pi-code-wt-plain-'));
    try {
      await expect(getGitRoot(plain)).resolves.toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('createIsolatedWorktree', () => {
  it('returns null when the base directory is not a repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'pi-code-wt-plain-'));
    try {
      await expect(createIsolatedWorktree(plain)).resolves.toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it('checks out the committed state into a separate detached worktree', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'committed\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);

    expect(await canonical(worktree.baseRoot)).toBe(await canonical(base));
    // The agent must not write straight into the user's working tree.
    expect(await canonical(worktree.path)).not.toBe(await canonical(base));
    expect(await readFile(join(worktree.path, 'tracked.txt'), 'utf8')).toBe('committed\n');
  });

  it('carries the working tree state into the isolated copy', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'committed\n');
    await commitAll('initial');
    // The base holds an uncommitted edit and a file that is not part of HEAD.
    await writeFile(join(base, 'tracked.txt'), 'uncommitted\n');
    await writeFile(join(base, 'untracked.txt'), 'untracked\n');

    const worktree = await expectWorktree(base);

    expect(await readFile(join(worktree.path, 'tracked.txt'), 'utf8')).toBe('uncommitted\n');
    expect(await readFile(join(worktree.path, 'untracked.txt'), 'utf8')).toBe('untracked\n');
    // The starting state is frozen so later diffs hold only the agent's work.
    const frozen = await git(worktree.path, ['show', `${worktree.baseCommit}:tracked.txt`]);
    expect(frozen).toBe('uncommitted\n');
  });
});

describe('integrateIsolatedWorktree', () => {
  it('applies the agent changes back into the base working tree', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'original\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);
    await writeFile(join(worktree.path, 'tracked.txt'), 'agent change\n');
    await writeFile(join(worktree.path, 'added.txt'), 'added by the agent\n');

    const result = await integrateIsolatedWorktree(worktree);

    expect(result.ok).toBe(true);
    expect(await readFile(join(base, 'tracked.txt'), 'utf8')).toBe('agent change\n');
    expect(await readFile(join(base, 'added.txt'), 'utf8')).toBe('added by the agent\n');
    // The isolated copy is cleaned up once its work landed.
    expect(await exists(worktree.path)).toBe(false);
  });

  it('reports success without touching the base when the agent changed nothing', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'original\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);

    const result = await integrateIsolatedWorktree(worktree);

    expect(result).toEqual({ ok: true });
    expect(await readFile(join(base, 'tracked.txt'), 'utf8')).toBe('original\n');
    expect(await exists(worktree.path)).toBe(false);
  });

  it('keeps the isolated copy and the patch when the changes cannot be merged back', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'original\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);
    await writeFile(join(worktree.path, 'tracked.txt'), 'agent change\n');

    // The base repository moves on with a conflicting edit.
    await writeFile(join(base, 'tracked.txt'), 'base moved on\n');
    await commitAll('base moved on');

    const result = await integrateIsolatedWorktree(worktree);

    expect(result.ok).toBe(false);
    const reason = 'reason' in result ? result.reason : '';
    expect(reason).toContain(worktree.path);
    expect(reason).toContain('Could not apply the isolated changes back to the workspace');
    // The isolated copy survives so the agent's work is not thrown away.
    expect(await exists(worktree.path)).toBe(true);
    expect(errors.join('\n')).toContain('Could not apply the isolated changes back to the workspace');
  });

  it('reports a failure when the isolated worktree can no longer be read', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'original\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);
    await rm(worktree.path, { recursive: true, force: true });

    const result = await integrateIsolatedWorktree(worktree);

    expect(result.ok).toBe(false);
    expect('reason' in result ? result.reason : '').toContain('Could not read the worktree diff');
  });
});

describe('removeWorktreeDirectory', () => {
  it('drops the isolated worktree and leaves the base repository untouched', async () => {
    const base = await baseRepo();
    await writeFile(join(base, 'tracked.txt'), 'original\n');
    await commitAll('initial');

    const worktree = await expectWorktree(base);
    await writeFile(join(worktree.path, 'tracked.txt'), 'agent change\n');

    await removeWorktreeDirectory(worktree);

    expect(await exists(worktree.path)).toBe(false);
    expect(await readFile(join(base, 'tracked.txt'), 'utf8')).toBe('original\n');

    const porcelain = await git(base, ['worktree', 'list', '--porcelain']);
    const paths = porcelain
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
    expect(paths).toHaveLength(1);
    expect(await canonical(paths[0])).toBe(await canonical(base));
  });
});
