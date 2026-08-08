import type { Webview } from 'vscode';
import type { AgentRunner } from '@pi-code/extension/structures/agent-runtime/runner';
import type { SessionService } from '@pi-code/extension/structures/agent-webview/session';
import type { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

export type MessageHandlerContext = {
  readonly cwd: string;
  readonly webview: Webview;
  readonly agent: AgentRunner;
  readonly recreateAgent: () => AgentRunner;
  readonly postMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly sessionService: SessionService;
  readonly workspaceService: WorkspaceService;
};
