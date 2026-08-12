import { formatThrownValue } from '@earendil-works/pi-ai';
import { generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { Uri, workspace } from 'vscode';

import { isBinaryFile } from '@pi-code/extension/utilities/codec';
import { GIT_STATUS } from '@pi-code/extension/utilities/git';
import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Change, Repository } from '@pi-code/extension/types/git';

const RECENT_COMMIT_COUNT = 5;

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

  for (const file of changes.filter((c) => c.isUntracked)) {
    try {
      diffContext += await buildUntrackedPatch(file);
    } catch (err) {
      diffContext += `\nError reading untracked file ${file.relativePath}: ${formatThrownValue(err)}\n`;
    }
  }

  return diffContext;
}

export async function getRepoContext(repo: Repository): Promise<{ branch: string; recentCommits: string }> {
  const branch = repo.state.HEAD?.name ?? 'unknown';

  let recentCommits = '';
  try {
    const commits = await repo.log({ maxEntries: RECENT_COMMIT_COUNT });
    recentCommits = commits.map((commit) => `${commit.hash.substring(0, 7)} ${commit.message.split('\n')[0]}`).join('\n');
  } catch {
    recentCommits = '';
  }

  return { branch, recentCommits };
}

export function buildGitContext(changes: ResolvedGitChange[], diff: string, branch: string, recentCommits: string, useStaged: boolean): string {
  let context = '## Git Context\n\n';

  const changeDescriptor = useStaged ? 'Staged' : 'Unstaged';
  context += `### Full Diff of ${changeDescriptor} Changes\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

  if (changes.length > 0) {
    const summaryLines = changes.map((c) => {
      const scope = c.isStaged ? 'staged' : 'unstaged';
      let statusName = 'Modified';
      if (c.isUntracked) statusName = 'Added';
      else if (c.isDeleted) statusName = 'Deleted';
      return `${statusName} (${scope}): ${c.relativePath}`;
    });
    context += '### Change Summary\n\n```\n' + summaryLines.join('\n') + '\n```\n\n';
  }

  context += '### Repository Context\n\n';
  if (branch && branch !== 'unknown') {
    context += `**Current branch:** \`${branch}\`\n\n`;
  }
  if (recentCommits) {
    context += `**Recent commits:**\n\n\`\`\`\n${recentCommits}\n\`\`\`\n`;
  }

  return context;
}
