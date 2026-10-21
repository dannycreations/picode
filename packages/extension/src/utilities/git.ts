import { execFile } from 'node:child_process';
import { extensions } from 'vscode';

import { logger } from '@pi-code/shared/core/logger';

import type { Uri } from 'vscode';
import type { API, GitExtension, Repository } from '@pi-code/extension/types/git';

// The VS Code git extension reports untracked files with status 7.
export const GIT_STATUS_UNTRACKED = 7;

async function getGitApi(): Promise<API | null> {
  const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    return null;
  }

  let gitExports: GitExtension | undefined;
  try {
    gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  } catch (err) {
    logger.warn('Git extension failed to activate; git features are disabled.', err);
    return null;
  }
  if (!gitExports?.enabled) {
    return null;
  }

  try {
    return gitExports.getAPI(1);
  } catch (err) {
    logger.warn('Git API is unavailable; git features are disabled.', err);
    return null;
  }
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
  } catch (err) {
    logger.debug('git check-ignore failed; treating all paths as tracked:', err);
    return new Set();
  }
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

interface GitCommandOptions {
  readonly maxBuffer?: number;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export function execGit(cwd: string, args: readonly string[], options: GitCommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'utf-8',
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env: options.env,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        // A failed command still produced output, and the caller usually wants
        // to show it, so the captured streams travel with the error.
        const failure = err as Error & { stdout?: string; stderr?: string };
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
      },
    );
  });
}
