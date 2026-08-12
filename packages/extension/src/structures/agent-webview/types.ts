import type { AgentRunner } from '@pi-code/extension/structures/agent-runtime/runner';
import type { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

export interface MessageHandlerContext {
  readonly cwd: string;
  readonly agent: AgentRunner;
  readonly workspace: WorkspaceService;
  readonly postMessage: (msg: ExtensionToWebviewMessage) => void;
}
