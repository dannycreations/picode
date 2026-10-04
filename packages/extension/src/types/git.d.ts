import type { Uri } from 'vscode';

export interface Change {
  readonly uri: Uri;
  readonly status: number;
}

interface RepositoryState {
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
}

export interface API {
  readonly repositories: readonly Repository[];
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}
