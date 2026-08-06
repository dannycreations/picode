import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { workspace } from 'vscode';

export function getWorkspaceCwd(): string {
  const workspaceFolders = workspace.workspaceFolders;
  return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
}

export function isProjectTrusted(cwd: string): boolean {
  if (workspace.isTrusted) {
    return true;
  }
  const agentDir = getAgentDir();
  const trustStore = new ProjectTrustStore(agentDir);
  if (!hasTrustRequiringProjectResources(cwd)) {
    return true;
  }
  return trustStore.get(cwd) === true;
}
