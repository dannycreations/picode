import { formatThrownValue } from '@earendil-works/pi-ai';
import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { normalizeSeparators } from '@pi-code/extension/utilities/fs';
import { logger } from '@pi-code/shared/core/logger';

// Session-level choice of which workspace folder Pi targets; undefined means
// "no explicit pick", so resolution falls back to the first folder.
let selectedWorkspaceUri: Uri | undefined;

export function setSelectedWorkspace(uri: Uri | undefined): void {
  selectedWorkspaceUri = uri;
}

export function getWorkspaceUri(): Uri | undefined {
  return selectedWorkspaceUri ?? workspace?.workspaceFolders?.[0]?.uri;
}

export function getWorkspaceCwd(): string {
  return getWorkspaceUri()?.fsPath ?? process.cwd();
}

function toUri(target: Uri | string): Uri {
  return typeof target === 'string' ? Uri.file(target) : target;
}

export function toRelativePath(target: Uri | string): string {
  return normalizeSeparators(workspace.asRelativePath(toUri(target), false));
}

export function toWorkspaceRelativePath(target: Uri | string): string | undefined {
  const uri = toUri(target);
  return workspace.getWorkspaceFolder(uri) ? toRelativePath(uri) : undefined;
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
