import { formatThrownValue } from '@earendil-works/pi-ai';
import { generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { Uri, workspace } from 'vscode';

import { isBinaryFile } from '@pi-code/extension/utilities/fs';
import { GIT_STATUS } from '@pi-code/extension/utilities/git';
import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Change, Repository } from '@pi-code/extension/types/git';

interface ResolvedGitChange {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly isStaged: boolean;
  readonly isUntracked: boolean;
  readonly isDeleted: boolean;
}

function mapChange(change: Change, isStaged: boolean): ResolvedGitChange {
  return {
    relativePath: toRelativePath(change.uri),
    absolutePath: change.uri.fsPath,
    isStaged,
    isUntracked: change.status === GIT_STATUS.UNTRACKED,
    isDeleted: change.status === GIT_STATUS.INDEX_DELETED || change.status === GIT_STATUS.DELETED,
  };
}

export async function getGitChanges(repo: Repository): Promise<{ changes: ResolvedGitChange[]; useStaged: boolean }> {
  // Refresh before reading so we don't act on stale async state.
  await repo.status();

  const stagedChanges = repo.state.indexChanges.map((c) => mapChange(c, true));

  if (stagedChanges.length > 0) {
    return { changes: stagedChanges, useStaged: true };
  }

  const unstagedChanges = [
    ...repo.state.workingTreeChanges.map((c) => mapChange(c, false)),
    ...repo.state.untrackedChanges.map((c) => mapChange(c, false)),
  ];
  return { changes: unstagedChanges, useStaged: false };
}

async function buildUntrackedPatch(file: ResolvedGitChange): Promise<string> {
  if (await isBinaryFile(file.absolutePath)) {
    return `\nBinary file ${file.relativePath} is untracked\n`;
  }

  const bytes = await workspace.fs.readFile(Uri.file(file.absolutePath));
  const content = new TextDecoder().decode(bytes);
  return `\n${generateUnifiedPatch(file.relativePath, '', content)}\n`;
}

export async function getGitDiffContext(repo: Repository, changes: ResolvedGitChange[], useStaged: boolean): Promise<string> {
  let diffContext = '';

  try {
    diffContext += await repo.diff(useStaged);
  } catch (err) {
    diffContext += `Error generating diff for changed files: ${formatThrownValue(err)}\n`;
  }

  // Untracked files are independent reads: fetch them in parallel instead of
  // one at a time so the cost scales with the slowest file, not their sum.
  const untracked = changes.filter((c) => c.isUntracked);
  if (untracked.length > 0) {
    const patches = await Promise.all(
      untracked.map((file) =>
        buildUntrackedPatch(file).catch((err) => `\nError reading untracked file ${file.relativePath}: ${formatThrownValue(err)}\n`),
      ),
    );
    diffContext += patches.join('');
  }

  return diffContext;
}
