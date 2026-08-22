import type { Runtime } from '@pi-code/extension/structures/agent-runtime/runtime';
import type { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';

export interface MessageHandlerContext {
  readonly runtime: Runtime;
  readonly workspace: WorkspaceService;

  cwd: string;
  historyEpoch: number;
}
