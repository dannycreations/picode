import { beforeEach, describe, expect, it, vi } from 'vitest';

import { matchCommits, parseGitLog, resolveCommitTag, searchCommits } from '../helpers/git';

const { execGitMock, getGitRepositoryMock } = vi.hoisted(() => ({
  execGitMock: vi.fn(),
  getGitRepositoryMock: vi.fn(),
}));

vi.mock('vscode', () => ({ Uri: { file: (path: string) => ({ fsPath: path }) } }));
vi.mock('@pi-code/extension/utilities/git', () => ({
  execGit: execGitMock,
  getGitRepository: getGitRepositoryMock,
}));

const REPO_ROOT = '/repo';
const CWD = '/repo/sub';
const LIMITS = { maxLines: 2000, maxBytes: 512 * 1024 };

// CRLF on purpose: `git` emits platform line endings that the parser must trim.
const LOG_OUTPUT = [
  '4e7c64ae11111111111111111111111111111111',
  '4e7c64ae',
  'dannycreations',
  '2026-08-25',
  'refactor: delegate command process management',
  '2a1b881f22222222222222222222222222222222',
  '2a1b881f',
  'dannycreations',
  '2026-08-24',
  'chore: bump workspace dependencies',
  '',
].join('\r\n');

function resolveGitWith(stdout: string): void {
  execGitMock.mockResolvedValue(stdout);
}

function failGitWith(message: string): void {
  execGitMock.mockRejectedValue(new Error(message));
}

beforeEach(() => {
  execGitMock.mockReset();
  getGitRepositoryMock.mockReset().mockResolvedValue({ rootUri: { fsPath: REPO_ROOT } });
});

describe('parseGitLog', () => {
  it('splits five-line records into commit items', () => {
    expect(parseGitLog(LOG_OUTPUT)).toEqual([
      {
        hash: '4e7c64ae11111111111111111111111111111111',
        shortHash: '4e7c64ae',
        subject: 'refactor: delegate command process management',
        author: 'dannycreations',
        date: '2026-08-25',
      },
      {
        hash: '2a1b881f22222222222222222222222222222222',
        shortHash: '2a1b881f',
        subject: 'chore: bump workspace dependencies',
        author: 'dannycreations',
        date: '2026-08-24',
      },
    ]);
  });

  it('stops at a truncated record instead of shifting the field order', () => {
    const truncated = [...LOG_OUTPUT.split('\r\n').slice(0, 5), 'orphan', 'lines'].join('\n');
    expect(parseGitLog(truncated)).toHaveLength(1);
  });
});

describe('matchCommits', () => {
  const commits = [
    { hash: 'aaaaaaaa11111111111111111111111111111111', shortHash: 'aaaaaaaa', subject: 'feat: picker', author: 'ada' },
    { hash: 'bbbbbbbb22222222222222222222222222222222', shortHash: 'bbbbbbbb', subject: 'fix: parser', author: 'linus' },
  ];

  it('caps the result list', () => {
    const many = Array.from({ length: 12 }, (_, at) => ({ hash: `h${at}`, shortHash: `h${at}`, subject: `subject ${at}` }));
    expect(matchCommits(many, '')).toHaveLength(10);
  });

  it('filters by subject, hash prefix, and author', () => {
    expect(matchCommits(commits, 'PARSER')).toEqual([commits[1]]);
    expect(matchCommits(commits, 'bbbbbbbb')).toEqual([commits[1]]);
    expect(matchCommits(commits, 'ada')).toEqual([commits[0]]);
  });

  it('offers a hash-shaped query that is outside the recent window', () => {
    expect(matchCommits([], '4e7c64a')).toEqual([{ hash: '4e7c64a', shortHash: '4e7c64a', subject: '4e7c64a' }]);
  });

  it('keeps non-hash queries with no match empty', () => {
    expect(matchCommits(commits, 'nothing')).toEqual([]);
  });
});

describe('searchCommits', () => {
  it('lists commits from the repository log', async () => {
    resolveGitWith(LOG_OUTPUT);

    const commits = await searchCommits('', CWD);

    expect(commits).toHaveLength(2);
    expect(execGitMock).toHaveBeenCalledWith(REPO_ROOT, ['log', '--max-count=50', '--date=short', '--format=%H%n%h%n%an%n%ad%n%s']);
  });

  it('returns nothing when no repository is found', async () => {
    getGitRepositoryMock.mockResolvedValue(undefined);

    await expect(searchCommits('', CWD)).resolves.toEqual([]);
    expect(execGitMock).not.toHaveBeenCalled();
  });

  it('returns nothing when git fails', async () => {
    failGitWith('not a git repository');

    await expect(searchCommits('', CWD)).resolves.toEqual([]);
  });
});

describe('resolveCommitTag', () => {
  it('passes ordinary words through untouched', async () => {
    await expect(resolveCommitTag('todo', CWD, LIMITS)).resolves.toBeNull();
    expect(getGitRepositoryMock).not.toHaveBeenCalled();
  });

  it('expands #changes into status and diff blocks', async () => {
    resolveGitWith('M src/a.ts\n');

    const block = await resolveCommitTag('changes', CWD, LIMITS);

    expect(block).toContain('## Working Changes');
    expect(block).toContain('M src/a.ts');
    expect(block).toContain('Diff vs HEAD:');
    const [statusCall, diffCall] = execGitMock.mock.calls;
    expect(statusCall).toEqual([REPO_ROOT, ['status', '--short']]);
    expect(diffCall).toEqual([REPO_ROOT, ['diff', '--no-color', 'HEAD']]);
  });

  it('keeps the status when only the diff fails', async () => {
    execGitMock.mockImplementation((_root: string, args: string[]) =>
      args[0] === 'diff' ? Promise.reject(new Error('unknown revision')) : Promise.resolve('M src/a.ts'),
    );

    const block = await resolveCommitTag('changes', CWD, LIMITS);

    expect(block).toContain('M src/a.ts');
    expect(block).toContain('Unavailable: unknown revision');
  });

  it('expands a commit hash with its show output', async () => {
    resolveGitWith('commit 4e7c64ae11111111111111111111111111111111\n    fix: thing');

    const block = await resolveCommitTag('4e7c64a', CWD, LIMITS);

    expect(block).toContain('## Commit: 4e7c64a');
    expect(block).toContain('fix: thing');
    expect(execGitMock).toHaveBeenCalledWith(REPO_ROOT, ['show', '--no-color', '--stat', '--patch', '4e7c64a']);
  });

  it('truncates oversized show output', async () => {
    resolveGitWith('line one\nline two\nline three');

    const block = await resolveCommitTag('4e7c64a', CWD, { maxLines: 2, maxBytes: 512 * 1024 });

    expect(block).toContain('Truncated');
  });

  it('reports failures for an unknown hash instead of dropping the reference', async () => {
    failGitWith('fatal: bad revision');

    const block = await resolveCommitTag('4e7c64a', CWD, LIMITS);

    expect(block).toContain('## Commit: 4e7c64a');
    expect(block).toContain('Unavailable: fatal: bad revision');
  });

  it('reports a missing repository for both tag kinds', async () => {
    getGitRepositoryMock.mockResolvedValue(undefined);

    await expect(resolveCommitTag('changes', CWD, LIMITS)).resolves.toContain('no git repository found');
    await expect(resolveCommitTag('4e7c64a', CWD, LIMITS)).resolves.toContain('no git repository found');
  });
});
