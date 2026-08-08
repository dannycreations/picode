import type { Webview } from 'vscode';
import type { AgentRunner } from '@extension/structures/agent-runtime/runner';
import type { SessionService } from '@extension/structures/agent-webview/session';
import type { WorkspaceService } from '@extension/structures/agent-webview/workspace';
import type { ExtensionToWebviewMessage } from '@extension/types/webview';

export type MessageHandlerContext = {
  readonly cwd: string;
  readonly webview: Webview;
  readonly agent: AgentRunner;
  readonly recreateAgent: () => AgentRunner;
  readonly postMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly sessionService: SessionService;
  readonly workspaceService: WorkspaceService;
};
