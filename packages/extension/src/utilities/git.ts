import { execFile } from 'node:child_process';
import { extensions } from 'vscode';

import { logger } from '@pi-code/shared/core/logger';

import type { Uri } from 'vscode';
import type { API, GitExtension, Repository } from '@pi-code/extension/types/git';

export const GIT_STATUS = {
  INDEX_DELETED: 2,
  DELETED: 6,
  UNTRACKED: 7,
} as const;

// The whole `git show` output must survive the exec buffer; trimming to a
// display budget happens afterwards on the complete text.
const GIT_MAX_BUFFER = 10 * 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;

async function getGitApi(): Promise<API | null> {
  const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    return null;
  }

  const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  if (!exports?.enabled) {
    return null;
  }

  return exports.getAPI(1);
}

export async function getGitRepository(uri?: Uri): Promise<Repository | null> {
  const api = await getGitApi();
  if (!api) {
    return null;
  }

  if (uri) {
    const repo = api.getRepository(uri);
    if (repo) {
      return repo;
    }
  }

  return api.repositories[0] ?? null;
}

export function execGit(root: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: GIT_MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export async function getIgnoredPaths(repo: Repository, absolutePaths: readonly string[]): Promise<Set<string>> {
  if (absolutePaths.length === 0) {
    return new Set();
  }
  try {
    return await repo.checkIgnore([...absolutePaths]);
  } catch (err) {
    logger.debug('git check-ignore failed; treating all paths as tracked:', err);
    return new Set();
  }
}
