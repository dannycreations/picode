import { Disposable, Uri, workspace } from 'vscode';

import { invalidateAppSettings, readAppSettings } from '@pi-code/extension/core/settings';
import { setApprovalPresenter } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { setSubagentEventCallback } from '@pi-code/extension/structures/agent-runtime/event';
import { Runtime } from '@pi-code/extension/structures/agent-runtime/runtime';
import { dispatch } from '@pi-code/extension/structures/agent-webview/dispatcher';
import { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { COMMAND_IDS, DEFAULT_APP_ID } from '@pi-code/shared/core/constants';

import type { CancellationToken, ExtensionContext, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from 'vscode';
import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';
import type { ToolArguments } from '@pi-code/shared/core/types';

function buildChatViewHtml(webview: Webview, extensionUri: Uri): string {
  const scriptUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const styleUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.css'));
  const codiconsUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'codicon.css'));

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'wasm-unsafe-eval'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet" />
  <title>Pi Code</title>
  <style>
    html, body, #root {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

export class ChatViewProvider implements WebviewViewProvider {
  public static readonly viewType = COMMAND_IDS.chatView;

  private readonly workspace: WorkspaceService;
  private runtime: Runtime | null = null;
  private activeWebview: Webview | null = null;

  public constructor(private readonly context: ExtensionContext) {
    this.workspace = new WorkspaceService(context.globalStorageUri);
  }

  // Global command → webview channel (show_settings, set_chat_input) used by
  // extension commands that run independently of any agent. Per-agent streaming
  // events travel through the Runtime Messenger instead.
  public postMessage(message: ExtensionToWebviewMessage): void {
    void this.activeWebview?.postMessage(message);
  }

  public resolveWebviewView(webviewView: WebviewView, _context: WebviewViewResolveContext, _token: CancellationToken): void {
    const webview = webviewView.webview;
    this.activeWebview = webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    webview.html = buildChatViewHtml(webview, this.context.extensionUri);

    this.runtime?.dispose();
    const runtime = new Runtime(webview);
    this.runtime = runtime;

    const cwd = getWorkspaceCwd();

    const disposeApprovalPresenter = setApprovalPresenter((request) => {
      // Route approval through the agent messenger so it shares the same sink
      // and coalescing buffer as the rest of the tool lifecycle.
      this.runtime?.postMessage({
        type: 'tool_approval_request',
        payload: {
          id: request.id,
          tool_name: request.toolName,
          arguments: request.args as ToolArguments,
          subagent: request.subagent,
          toolCallId: request.toolCallId,
        },
      });
    });

    const disposeSubagentEventCallback = setSubagentEventCallback((msg) => {
      // Route sub-agent events through the agent's WebviewMessenger so they
      // share the same 16 ms coalescing buffer as the main-agent stream.
      this.runtime?.postMessage(msg);
    });

    // One context per webview connection: historyEpoch must increase across
    // messages so concurrent history refreshs order themselves, and a
    // select_workspace must rewrite cwd for every later message.
    const context: MessageHandlerContext = { runtime, workspace: this.workspace, cwd, historyEpoch: 0 };

    const subscriptions = Disposable.from(
      webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        void dispatch(message, context);
      }),
      Disposable.from({ dispose: disposeApprovalPresenter }),
      Disposable.from({ dispose: disposeSubagentEventCallback }),
      // Mirror configuration edits made anywhere (settings UI, settings.json,
      // profile sync) back into the chat view.
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(DEFAULT_APP_ID)) return;
        invalidateAppSettings();
        void webview.postMessage({ type: 'settings_data', payload: { settings: readAppSettings() } });
      }),
    );

    webviewView.onDidDispose(() => {
      subscriptions.dispose();
      if (this.activeWebview === webview) {
        this.activeWebview = null;
      }
      this.runtime?.dispose();
    });
  }
}
