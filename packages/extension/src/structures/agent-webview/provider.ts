import { Disposable, Uri, workspace } from 'vscode';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { PolicyBridge } from '@pi-code/extension/structures/agent-runtime/policy';
import { AgentRunner } from '@pi-code/extension/structures/agent-runtime/runner';
import { createDefaultDispatcher } from '@pi-code/extension/structures/agent-webview/dispatcher';
import { SessionService } from '@pi-code/extension/structures/agent-webview/session';
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
  const nonce = crypto.randomUUID();

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

  private readonly sessionService = new SessionService();
  private readonly workspaceService: WorkspaceService;
  private readonly dispatcher = createDefaultDispatcher();

  private agent: AgentRunner = new AgentRunner();
  private activeWebview: Webview | null = null;

  public constructor(private readonly context: ExtensionContext) {
    this.workspaceService = new WorkspaceService(context.globalStorageUri);
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

    this.agent.dispose();
    this.agent = new AgentRunner();

    const cwd = getWorkspaceCwd();
    const self = this;

    const disposeApprovalPresenter = PolicyBridge.getInstance().setPresenter((request) => {
      void webview.postMessage({
        type: 'tool_approval_request',
        payload: {
          id: request.id,
          tool_name: request.toolName,
          arguments: JSON.stringify(request.args),
        },
      });
    });

    const handlerContext: MessageHandlerContext = {
      cwd,
      webview,
      get agent() {
        return self.agent;
      },
      recreateAgent: () => (self.agent = new AgentRunner()),
      postMessage: (msg) => webview.postMessage(msg),
      sessionService: this.sessionService,
      workspaceService: this.workspaceService,
    };

    const subscriptions = Disposable.from(
      webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        void this.dispatcher.dispatch(message, handlerContext);
      }),
      Disposable.from({ dispose: disposeApprovalPresenter }),
      // Mirror configuration edits made anywhere (settings UI, settings.json,
      // profile sync) back into the chat view.
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(manifest.name)) return;
        void webview.postMessage({ type: 'settings_data', payload: { settings: readAppSettings() } });
      }),
    );

    webviewView.onDidDispose(() => {
      subscriptions.dispose();
      if (this.activeWebview === webview) {
        this.activeWebview = null;
      }
      this.agent.dispose();
    });
  }
}
