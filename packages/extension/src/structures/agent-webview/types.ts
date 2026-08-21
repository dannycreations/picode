import type { Runtime } from '@pi-code/extension/structures/agent-runtime/runtime';
import type { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';

export interface MessageHandlerContext {
  readonly cwd: string;
  readonly runtime: Runtime;
  readonly workspace: WorkspaceService;
  // Monotonic epoch for history_data chunks; reset when the webview re-inits.
  historyEpoch: number;
}
