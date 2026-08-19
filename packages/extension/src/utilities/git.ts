import { extensions } from 'vscode';

import type { Uri } from 'vscode';
import type { API, GitExtension, Repository } from '@pi-code/extension/types/git';

export const GIT_STATUS = {
  INDEX_DELETED: 2,
  DELETED: 6,
  UNTRACKED: 7,
} as const;

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

export async function getIgnoredPaths(repo: Repository, absolutePaths: readonly string[]): Promise<Set<string>> {
  if (absolutePaths.length === 0) {
    return new Set();
  }
  try {
    return await repo.checkIgnore([...absolutePaths]);
  } catch {
    return new Set();
  }
}
