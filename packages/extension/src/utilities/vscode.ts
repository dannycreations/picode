import { formatThrownValue } from '@earendil-works/pi-ai';
import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { window, workspace } from 'vscode';

import { logger } from '@pi-code/shared/core/logger';
import { normalizeSeparators } from '@pi-code/shared/utilities/common';

import type { Uri } from 'vscode';

// Session-level choice of which workspace folder Pi targets; undefined means
// "no explicit pick", so resolution falls back to the first folder.
let selectedWorkspaceUri: Uri | undefined;

export function setSelectedWorkspace(uri: Uri | undefined): void {
  selectedWorkspaceUri = uri;
}

export function getWorkspaceUri(): Uri | undefined {
  // The optional chain on `workspace` is load-bearing: tests mock the vscode
  // module without this export, so the namespace value can be undefined.
  return selectedWorkspaceUri ?? workspace?.workspaceFolders?.[0]?.uri;
}

export function getWorkspaceCwd(): string {
  return getWorkspaceUri()?.fsPath ?? process.cwd();
}

export function toRelativePath(target: Uri): string {
  return normalizeSeparators(workspace.asRelativePath(target, false));
}

export function toWorkspaceRelativePath(target: Uri): string | undefined {
  return workspace.getWorkspaceFolder(target) ? toRelativePath(target) : undefined;
}

let trustStore: ProjectTrustStore | undefined;

export function isProjectTrusted(cwd: string): boolean {
  if (workspace.isTrusted) {
    return true;
  }
  if (!hasTrustRequiringProjectResources(cwd)) {
    return true;
  }
  trustStore ??= new ProjectTrustStore(getAgentDir());
  return trustStore.get(cwd) === true;
}

export function reportError(prefix: string, error: unknown): void {
  const message = `${prefix}: ${formatThrownValue(error)}`;
  logger.error(message, error);
  window.showErrorMessage(message);
}
