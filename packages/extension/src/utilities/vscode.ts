import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { Uri, workspace } from 'vscode';

import { normalizeSeparators } from '@pi-code/extension/utilities/fs';

export function getWorkspaceCwd(): string {
  const workspaceFolders = workspace?.workspaceFolders;
  return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
}

export function getWorkspaceUri(): Uri | undefined {
  return workspace.workspaceFolders?.[0]?.uri;
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
