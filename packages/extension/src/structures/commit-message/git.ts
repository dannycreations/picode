import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isBinaryFileSync } from '@pi-code/extension/utilities/binary';
import { toErrorMessage } from '@pi-code/shared/utilities/common';

interface GitChange {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly isStaged: boolean;
  readonly isUntracked: boolean;
  readonly isDeleted: boolean;
}

export function spawnGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Git command failed: ${result.stderr}`);
  }
  return result.stdout;
}

export function getGitChanges(cwd: string): { changes: GitChange[]; useStaged: boolean } {
  const output = spawnGit(['status', '--porcelain'], cwd).trim();
  if (!output) {
    return { changes: [], useStaged: false };
  }

  const lines = output.split('\n');
  const allChanges: GitChange[] = [];

  for (const line of lines) {
    if (line.length < 4) continue;
    const indexStatus = line.charAt(0);
    const workStatus = line.charAt(1);

    let relativePath = line.substring(3).trim();
    if (indexStatus === 'R' || workStatus === 'R') {
      const parts = relativePath.split(' -> ');
      relativePath = parts[1] || parts[0];
    }

    const absolutePath = resolve(cwd, relativePath);
    const isStaged = indexStatus !== ' ' && indexStatus !== '?';
    const isUntracked = indexStatus === '?' && workStatus === '?';
    const isDeleted = indexStatus === 'D' || workStatus === 'D';

    allChanges.push({
      relativePath,
      absolutePath,
      isStaged,
      isUntracked,
      isDeleted,
    });
  }

  const stagedChanges = allChanges.filter((c) => c.isStaged);
  if (stagedChanges.length > 0) {
    return { changes: stagedChanges, useStaged: true };
  }

  const unstagedChanges = allChanges.filter((c) => !c.isStaged);
  return { changes: unstagedChanges, useStaged: false };
}

export function getGitDiffContext(cwd: string, changes: GitChange[], useStaged: boolean): string {
  let diffContext = '';

  const standardFiles = changes.filter((c) => !c.isUntracked && !c.isDeleted);
  if (standardFiles.length > 0) {
    const filePaths = standardFiles.map((c) => c.relativePath);
    try {
      const args = ['diff'];
      if (useStaged) {
        args.push('--cached');
      }
      args.push('--');
      args.push(...filePaths);
      diffContext += spawnGit(args, cwd);
    } catch (err) {
      diffContext += `Error generating diff for standard files: ${toErrorMessage(err)}\n`;
    }
  }

  const untrackedFiles = changes.filter((c) => c.isUntracked);
  for (const file of untrackedFiles) {
    if (isBinaryFileSync(file.absolutePath)) {
      diffContext += `\nBinary file ${file.relativePath} is untracked\n`;
      continue;
    }
    try {
      if (existsSync(file.absolutePath)) {
        const content = readFileSync(file.absolutePath, 'utf8');
        diffContext += `\n--- /dev/null\n+++ b/${file.relativePath}\n@@ -0,0 +1,${content.split('\n').length} @@\n`;
        diffContext +=
          content
            .split('\n')
            .map((line) => '+' + line)
            .join('\n') + '\n';
      }
    } catch (err) {
      diffContext += `\nError reading untracked file ${file.relativePath}: ${toErrorMessage(err)}\n`;
    }
  }

  const deletedFiles = changes.filter((c) => c.isDeleted);
  for (const file of deletedFiles) {
    diffContext += `\nFile deleted: ${file.relativePath}\n`;
  }

  return diffContext;
}

export function getRepoContext(cwd: string): { branch: string; recentCommits: string } {
  let branch = 'unknown';
  let recentCommits = '';
  try {
    branch = spawnGit(['branch', '--show-current'], cwd).trim();
  } catch {
    try {
      branch = spawnGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
    } catch {}
  }
  try {
    recentCommits = spawnGit(['log', '--oneline', '-5'], cwd).trim();
  } catch {}

  return { branch, recentCommits };
}

export function buildGitContext(changes: GitChange[], diff: string, branch: string, recentCommits: string, useStaged: boolean): string {
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
