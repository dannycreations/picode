import { formatThrownValue } from '@earendil-works/pi-ai';
import { Uri } from 'vscode';

import { execGit, getGitRepository } from '@pi-code/extension/utilities/git';
import { renderTruncatedText, truncateOutput } from '@pi-code/extension/utilities/truncate';
import { COMMIT_HASH_PATTERN, SHORT_HASH_LENGTH, WORKING_CHANGES_TAG } from '@pi-code/shared/core/constants';

import type { OutputLimits } from '@pi-code/extension/utilities/truncate';
import type { CommitItem } from '@pi-code/shared/core/protocol';

const COMMIT_SEARCH_WINDOW = 50;
const COMMIT_RESULT_CAP = 10;
// One commit per five lines: hash, short hash, author, date, subject.
const LOG_ARGUMENTS = ['--date=short', '--format=%H%n%h%n%an%n%ad%n%s'] as const;

async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const repo = await getGitRepository(Uri.file(cwd)).catch(() => null);
  return repo?.rootUri.fsPath ?? null;
}

export function parseGitLog(output: string): CommitItem[] {
  const lines = output.split('\n').map((line) => line.trim());
  const commits: CommitItem[] = [];

  for (let at = 0; at <= lines.length - 5; at += 5) {
    const [hash, shortHash, author, date, subject] = lines.slice(at, at + 5);
    if (!hash) break;
    commits.push({ hash, shortHash, subject, author: author || undefined, date: date || undefined });
  }
  return commits;
}

export function matchCommits(commits: readonly CommitItem[], query: string): CommitItem[] {
  const needle = query.trim().toLowerCase();
  const matched = commits.filter(
    (commit) =>
      needle.length === 0 ||
      commit.hash.toLowerCase().startsWith(needle) ||
      commit.subject.toLowerCase().includes(needle) ||
      (commit.author ?? '').toLowerCase().includes(needle),
  );

  const results = matched.slice(0, COMMIT_RESULT_CAP);
  if (results.length > 0 || !COMMIT_HASH_PATTERN.test(needle)) return results;

  // A hash outside the recent window still gets an entry: `git show` resolves
  // it at expansion time even though the log listing cannot.
  return [{ hash: needle, shortHash: needle.slice(0, SHORT_HASH_LENGTH), subject: needle }];
}

export async function searchCommits(query: string, cwd: string): Promise<CommitItem[]> {
  try {
    const root = await resolveRepoRoot(cwd);
    if (!root) return [];

    const output = await execGit(root, ['log', `--max-count=${COMMIT_SEARCH_WINDOW}`, ...LOG_ARGUMENTS]);
    return matchCommits(parseGitLog(output), query);
  } catch {
    return [];
  }
}

async function commitBody(token: string, root: string, limits: OutputLimits): Promise<string> {
  const show = await execGit(root, ['show', '--no-color', '--stat', '--patch', token]);
  return renderTruncatedText(truncateOutput(show, { limits }), 'head').trim();
}

async function workingChangesBody(root: string, limits: OutputLimits): Promise<string> {
  // The two reads are independent; a failed diff must not hide a useful status.
  const [status, diff] = await Promise.all([
    execGit(root, ['status', '--short']),
    execGit(root, ['diff', '--no-color', 'HEAD']).catch((err) => `Unavailable: ${formatThrownValue(err)}`),
  ]);
  return [
    'Status:',
    '',
    status.trim() || '(clean)',
    '',
    'Diff vs HEAD:',
    '',
    renderTruncatedText(truncateOutput(diff, { limits }), 'head').trim() || '(no diff)',
  ].join('\n');
}

export async function resolveCommitTag(token: string, cwd: string, limits: OutputLimits): Promise<string | null> {
  const isWorkingChanges = token === WORKING_CHANGES_TAG;
  if (!isWorkingChanges && !COMMIT_HASH_PATTERN.test(token)) return null;

  const header = isWorkingChanges ? '## Working Changes' : `## Commit: ${token}`;
  const root = await resolveRepoRoot(cwd);
  if (!root) return `${header}\n\nUnavailable: no git repository found.`;

  try {
    const body = isWorkingChanges ? await workingChangesBody(root, limits) : await commitBody(token, root, limits);
    return `${header}\n\n${body}`;
  } catch (err) {
    return `${header}\n\nUnavailable: ${formatThrownValue(err)}`;
  }
}
