import { Uri } from 'vscode';

import { AgentRunner } from '@extension/structures/agent-runtime/runner';
import { createDefaultDispatcher } from '@extension/structures/agent-webview/dispatcher';
import { SessionService } from '@extension/structures/agent-webview/session';
import { WorkspaceService } from '@extension/structures/agent-webview/workspace';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@extension/types/webview';

import type { CancellationToken, ExtensionContext, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from 'vscode';
import type { MessageHandlerContext } from '@extension/structures/agent-webview/dispatcher';
import type { SessionInitData } from '@extension/structures/agent-webview/session';

export class ChatViewHtml {
  public static build(webview: Webview, extensionUri: Uri): string {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.cjs'));
    const styleUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview.css'));
    const codiconsUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'codicon.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
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
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export class ChatViewProvider implements WebviewViewProvider {
  public static readonly viewType = 'pi-code.chatView';
  private static activeWebview: Webview | null = null;

  private readonly cachedInitData: Record<string, SessionInitData> = {};
  private readonly sessionService = new SessionService();
  private readonly workspaceService = new WorkspaceService();
  private readonly dispatcher = createDefaultDispatcher();

  private agent: AgentRunner = new AgentRunner();

  public constructor(private readonly context: ExtensionContext) {}

  public static postActiveWebviewMessage(message: ExtensionToWebviewMessage): Thenable<boolean> | undefined {
    return this.activeWebview?.postMessage(message);
  }

  public resolveWebviewView(webviewView: WebviewView, _context: WebviewViewResolveContext, _token: CancellationToken): void {
    const webview = webviewView.webview;
    ChatViewProvider.activeWebview = webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = ChatViewHtml.build(webview, this.context.extensionUri);

    const cwd = WorkspaceService.getCwd();

    const listener = webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      const context: MessageHandlerContext = {
        cwd,
        webview,
        agent: this.agent,
        recreateAgent: () => (this.agent = new AgentRunner()),
        postMessage: (msg) => webview.postMessage(msg),
        cachedInitData: this.cachedInitData,
        sessionService: this.sessionService,
        workspaceService: this.workspaceService,
      };

      void this.dispatcher.dispatch(message, context);
    });

    webviewView.onDidDispose(() => {
      listener.dispose();
      if (ChatViewProvider.activeWebview === webview) {
        ChatViewProvider.activeWebview = null;
      }
      this.agent.dispose();
    });
  }
}
