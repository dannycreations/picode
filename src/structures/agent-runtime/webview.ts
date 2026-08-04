import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@extension/types/webview';

export class WebviewMessenger {
  private webview: Webview | null = null;
  private isDisposed = false;

  public attach(webview: Webview): void {
    this.webview = webview;
  }

  public post(message: ExtensionToWebviewMessage): void {
    if (this.isDisposed || !this.webview) {
      return;
    }
    void this.webview.postMessage(message);
  }

  public postError(err: unknown): void {
    this.post({
      type: 'agent_error',
      payload: {
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    this.webview = null;
  }
}
