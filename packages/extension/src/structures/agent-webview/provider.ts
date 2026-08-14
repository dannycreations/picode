import { uuidv7 } from '@earendil-works/pi-ai';
import { Disposable, Uri, workspace } from 'vscode';

import { invalidateAppSettings, readAppSettings } from '@pi-code/extension/core/settings';
import { setApprovalPresenter, setSubagentEventCallback } from '@pi-code/extension/structures/agent-runtime/brokers/policy';
import { AgentRunner } from '@pi-code/extension/structures/agent-runtime/runner';
import { dispatch } from '@pi-code/extension/structures/agent-webview/dispatcher';
import { WorkspaceService } from '@pi-code/extension/structures/agent-webview/workspace';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import manifest from '../../../package.json' with { type: 'json' };

import type { CancellationToken, ExtensionContext, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from 'vscode';
import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';

function buildChatViewHtml(webview: Webview, extensionUri: Uri): string {
  const scriptUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.cjs'));
  const styleUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.css'));
  const codiconsUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'codicon.css'));
  const nonce = uuidv7();

  // Content-Security-Policy per the VS Code webview guidelines: only our nonced
  // bundle may execute, remote content is limited to `webview.cspSource`, and
  // `default-src 'none'` leaves network access blocked. `wasm-unsafe-eval` is
  // required by the Shiki highlighter, which instantiates an inlined WASM module.
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export class ChatViewProvider implements WebviewViewProvider {
  public static readonly viewType = 'pi-code.chatView';

  private readonly workspace: WorkspaceService;
  private agent: AgentRunner | null = null;
  private activeWebview: Webview | null = null;

  public constructor(private readonly context: ExtensionContext) {
    this.workspace = new WorkspaceService(context.globalStorageUri);
  }

  // Global command → webview channel (show_settings, set_chat_input) used by
  // extension commands that run independently of any agent. Per-agent streaming
  // events travel through the AgentRunner's WebviewMessenger instead.
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

    this.agent?.dispose();
    this.agent = new AgentRunner(webview);

    const cwd = getWorkspaceCwd();

    const disposeApprovalPresenter = setApprovalPresenter((request) => {
      void webview.postMessage({
        type: 'tool_approval_request',
        payload: {
          id: request.id,
          tool_name: request.toolName,
          arguments: JSON.stringify(request.args),
          subagent: request.subagent,
        },
      });
    });

    const disposeSubagentEventCallback = setSubagentEventCallback((msg) => {
      void webview.postMessage(msg);
    });

    const handlerContext: MessageHandlerContext = {
      cwd,
      agent: this.agent!,
      workspace: this.workspace,
      postMessage: (msg) => this.agent!.postMessage(msg),
    };

    const subscriptions = Disposable.from(
      webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        void dispatch(message, handlerContext);
      }),
      Disposable.from({ dispose: disposeApprovalPresenter }),
      Disposable.from({ dispose: disposeSubagentEventCallback }),
      // Mirror configuration edits made anywhere (settings UI, settings.json,
      // profile sync) back into the chat view.
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(manifest.name)) return;
        invalidateAppSettings();
        void webview.postMessage({ type: 'settings_data', payload: { settings: readAppSettings() } });
      }),
    );

    webviewView.onDidDispose(() => {
      subscriptions.dispose();
      if (this.activeWebview === webview) {
        this.activeWebview = null;
      }
      this.agent?.dispose();
    });
  }
}
