import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAgentDir, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Range, Uri, window, workspace } from 'vscode';

import { AgentRunner } from '@extension/core/agent';
import { calculateSessionStats, convertSessionEntries } from '@extension/structures/chat-session/session';
import { AgentModel, SessionTreeEntry } from '@extension/types/extension';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@extension/types/webview';

import type { CancellationToken, ExtensionContext, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext } from 'vscode';

export class ChatViewProvider implements WebviewViewProvider {
  public static readonly viewType = 'pi-code.chatView';
  private static activeWebview: Webview | null = null;
  private agent: AgentRunner | null = null;

  public static postActiveWebviewMessage(message: ExtensionToWebviewMessage): Thenable<boolean> | undefined {
    if (this.activeWebview) {
      return this.activeWebview.postMessage(message);
    }
    return undefined;
  }

  public constructor(private readonly context: ExtensionContext) {}

  public resolveWebviewView(webviewView: WebviewView, _context: WebviewViewResolveContext, _token: CancellationToken): void {
    ChatViewProvider.activeWebview = webviewView.webview;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Instantiate runner
    this.agent = new AgentRunner();

    const workspaceFolders = workspace.workspaceFolders;
    const cwd = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();

    // Set up message listener for basic extension communication
    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (!this.agent) {
        return;
      }
      switch (message.type) {
        case 'init':
          await this.sendInitData(webviewView.webview, cwd);
          break;

        case 'start_new_task':
          void this.agent.startTask(message.text, message.model_id || '', webviewView.webview);
          break;

        case 'send_message':
          void this.agent.startTask(message.text, '', webviewView.webview);
          break;

        case 'approve_tool':
          this.agent.approveTool(message.approval_id);
          break;

        case 'deny_tool':
          this.agent.denyTool(message.approval_id);
          break;

        case 'close_task':
          this.agent.dispose();
          this.agent = new AgentRunner();
          break;

        case 'cancel_task':
          this.agent.abort();
          break;

        case 'load_session':
          try {
            const sessionManager = SessionManager.open(message.path);
            const entries = sessionManager.getEntries() as SessionTreeEntry[];
            const chatMessages = convertSessionEntries(entries);

            // Fetch configured models and retrieve default model ID
            const modelRuntime = await ModelRuntime.create();
            const models = modelRuntime.getModels();
            const agentDir = getAgentDir();
            const settingsManager = SettingsManager.create(cwd, agentDir);
            let sessionModelId = settingsManager.getDefaultModel();

            // Find if there is a model change entry in the history
            for (const entry of entries) {
              if ((entry as any).type === 'model_change') {
                sessionModelId = (entry as any).modelId || sessionModelId;
              }
            }

            // Resolve contextLimit from the matched model
            let contextLimit = 200000;
            if (sessionModelId) {
              const matchedModel = models.find((m) => m.id === sessionModelId);
              if (matchedModel && typeof matchedModel.contextWindow === 'number') {
                contextLimit = matchedModel.contextWindow;
              }
            }

            const stats = calculateSessionStats(entries, contextLimit);
            this.postWebviewMessage(webviewView.webview, {
              type: 'session_loaded',
              payload: {
                id: message.id,
                title: message.title,
                messages: chatMessages,
                path: message.path,
                ...stats,
              },
            });
          } catch (err) {
            console.error('Failed to load session:', err);
          }
          break;

        case 'view_raw_task':
          try {
            let path = message.path;
            if (!path && this.agent) {
              path = this.agent.getSessionFile();
            }
            if (path) {
              const uri = Uri.file(path);
              const doc = await workspace.openTextDocument(uri);
              await window.showTextDocument(doc);
            } else {
              window.showWarningMessage('No session file path found for this task.');
            }
          } catch (err) {
            console.error('Failed to open raw task:', err);
            window.showErrorMessage(`Failed to open task JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;

        case 'export_session':
          try {
            const sessionManager = SessionManager.open(message.path);
            const entries = sessionManager.getEntries() as SessionTreeEntry[];
            const chatMessages = convertSessionEntries(entries);
            const jsonString = JSON.stringify(chatMessages, null, 2);

            const uri = await window.showSaveDialog({
              defaultUri: Uri.file(`pi-code-task-${message.id || Date.now()}.json`),
              filters: {
                'JSON Files': ['json'],
              },
            });
            if (uri) {
              await workspace.fs.writeFile(uri, Buffer.from(jsonString, 'utf8'));
              window.showInformationMessage('Task exported successfully!');
            }
          } catch (err) {
            console.error('Failed to export session:', err);
            window.showErrorMessage(`Failed to export task: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;

        case 'open_file':
          try {
            const filePath = resolve(cwd, message.text);
            const uri = Uri.file(filePath);
            const doc = await workspace.openTextDocument(uri);
            const selection = message.values?.line ? new Range(message.values.line - 1, 0, message.values.line - 1, 0) : undefined;
            await window.showTextDocument(doc, { selection });
          } catch (err) {
            console.error('Failed to open file:', err);
            window.showErrorMessage(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;

        case 'get_history':
          try {
            const scope = message.scope || 'current';
            let sessions;
            if (scope === 'all') {
              sessions = await SessionManager.listAll();
            } else {
              sessions = await SessionManager.list(cwd);
            }
            const history = sessions.map((s) => ({
              id: s.id,
              path: s.path,
              task: s.firstMessage || 'Untitled Task',
              ts: s.created ? new Date(s.created).getTime() : Date.now(),
            }));
            this.postWebviewMessage(webviewView.webview, {
              type: 'history_data',
              payload: {
                history,
              },
            });
          } catch (err) {
            console.error('Failed to get history:', err);
          }
          break;

        case 'delete_sessions':
          try {
            const { paths, scope } = message;
            for (const p of paths) {
              try {
                await unlink(p);
              } catch (unlinkErr) {
                console.error(`Failed to delete session file at ${p}:`, unlinkErr);
              }
            }
            // Send updated history for the active scope
            let sessions;
            if (scope === 'all') {
              sessions = await SessionManager.listAll();
            } else {
              sessions = await SessionManager.list(cwd);
            }
            const history = sessions.map((s) => ({
              id: s.id,
              path: s.path,
              task: s.firstMessage || 'Untitled Task',
              ts: s.created ? new Date(s.created).getTime() : Date.now(),
            }));
            this.postWebviewMessage(webviewView.webview, {
              type: 'history_data',
              payload: {
                history,
              },
            });
            // Update the main page history list too
            await this.sendInitData(webviewView.webview, cwd);
          } catch (err) {
            console.error('Failed to delete sessions:', err);
          }
          break;

        default:
          break;
      }
    });

    webviewView.onDidDispose(() => {
      if (ChatViewProvider.activeWebview === webviewView.webview) {
        ChatViewProvider.activeWebview = null;
      }
      if (this.agent) {
        this.agent.dispose();
        this.agent = null;
      }
    });
  }

  private postWebviewMessage(webview: Webview, message: ExtensionToWebviewMessage): Thenable<boolean> {
    return webview.postMessage(message);
  }

  private async sendInitData(webview: Webview, cwd: string): Promise<void> {
    try {
      const modelRuntime = await ModelRuntime.create();

      const models = modelRuntime.getModels().map((m: AgentModel) => ({
        id: m.id,
        name: m.displayName || m.id,
      }));

      const sessions = await SessionManager.list(cwd);
      const history = sessions.map((s) => ({
        id: s.id,
        path: s.path,
        task: s.firstMessage || 'Untitled Task',
        ts: s.created ? new Date(s.created).getTime() : Date.now(),
      }));

      const agentDir = getAgentDir();
      const settingsManager = SettingsManager.create(cwd, agentDir);
      const defaultModel = settingsManager.getDefaultModel();

      this.postWebviewMessage(webview, {
        type: 'init_data',
        payload: {
          models,
          history,
          default_model: defaultModel,
        },
      });
    } catch (err) {
      console.error('Failed to send init data:', err);
    }
  }

  private getHtmlForWebview(webview: Webview): string {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'dist', 'webview.cjs'));
    const styleUri = webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const codiconsUri = webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'dist', 'codicon.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet" />
  <title>Pi Code Chat</title>
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
