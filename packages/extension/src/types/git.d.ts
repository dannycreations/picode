import type { Uri } from 'vscode';

export enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,

  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,

  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}

export interface Change {
  readonly uri: Uri;
  readonly status: Status;
}

export interface RepositoryState {
  readonly HEAD: { readonly name?: string } | undefined;
  readonly indexChanges: readonly Change[];
  readonly mergeChanges: readonly Change[];
  readonly workingTreeChanges: readonly Change[];
  readonly untrackedChanges: readonly Change[];
}

export interface Repository {
  readonly rootUri: Uri;
  readonly inputBox: { value: string };
  readonly state: RepositoryState;
  checkIgnore(paths: string[]): Promise<Set<string>>;
  status(): Promise<void>;
  diff(cached?: boolean): Promise<string>;
  log(options?: { maxEntries?: number }): Promise<readonly { readonly hash: string; readonly message: string }[]>;
}

export interface API {
  readonly repositories: readonly Repository[];
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
