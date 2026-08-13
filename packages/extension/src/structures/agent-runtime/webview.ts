import { formatThrownValue } from '@earendil-works/pi-ai';

import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

const FLUSH_INTERVAL_MS = 16;

export class WebviewMessenger {
  private webview: Webview | null = null;
  private isDisposed = false;
  private textBuffer = '';
  private thinkingBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  public attach(webview: Webview): void {
    this.webview = webview;
  }

  public post(message: ExtensionToWebviewMessage): void {
    if (this.isDisposed || !this.webview) {
      return;
    }

    if (message.type === 'stream_delta') {
      if (message.payload.text) this.textBuffer += message.payload.text;
      if (message.payload.thinking) this.thinkingBuffer += message.payload.thinking;
      this.scheduleFlush();
      return;
    }

    this.flush();
    void this.webview.postMessage(message);
  }

  public postError(err: unknown): void {
    this.post({
      type: 'agent_error',
      payload: { message: formatThrownValue(err) },
    });
  }

  public dispose(): void {
    this.flush();
    this.isDisposed = true;
    this.webview = null;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.isDisposed || !this.webview) {
      this.textBuffer = '';
      this.thinkingBuffer = '';
      return;
    }
    if (this.textBuffer || this.thinkingBuffer) {
      void this.webview.postMessage({
        type: 'stream_delta',
        payload: {
          text: this.textBuffer || undefined,
          thinking: this.thinkingBuffer || undefined,
        },
      });
      this.textBuffer = '';
      this.thinkingBuffer = '';
    }
  }
}
