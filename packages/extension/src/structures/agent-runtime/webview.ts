import { formatThrownValue } from '@earendil-works/pi-ai';

import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

const FLUSH_INTERVAL_MS = 16;

interface CoalescedToolUpdate {
  toolName?: string;
  result: string;
  subagent?: string;
  subtitle?: string;
}

export class WebviewMessenger {
  private webview: Webview | null = null;
  private isDisposed = false;
  private textBuffer = '';
  private thinkingBuffer = '';
  private toolUpdates = new Map<string, CoalescedToolUpdate>();
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

    // Sub-agent events arrive through this same messenger; their start/update/
    // end events mirror the main-agent tool lifecycle below.
    if (message.type === 'tool_execution_start') {
      const entry = this.toolUpdates.get(message.payload.id) ?? { result: '', subagent: undefined, subtitle: undefined };
      entry.toolName = message.payload.tool_name;
      this.toolUpdates.set(message.payload.id, entry);
      this.flush();
      void this.webview.postMessage(message);
      return;
    }

    if (message.type === 'tool_execution_update') {
      const { id, result, subagent, subtitle } = message.payload;
      const entry = this.toolUpdates.get(id) ?? { toolName: undefined, result: '', subagent: undefined, subtitle: undefined };
      const isAppend = entry.toolName === 'execute_command';
      entry.result = isAppend && entry.result ? entry.result + result : result;
      entry.subagent = subagent ?? entry.subagent;
      entry.subtitle = subtitle ?? entry.subtitle;
      this.toolUpdates.set(id, entry);
      this.scheduleFlush();
      return;
    }

    if (message.type === 'tool_execution_end') {
      this.toolUpdates.delete(message.payload.id);
      this.flush();
      void this.webview.postMessage(message);
      return;
    }

    this.flush();
    void this.webview.postMessage(message);
  }

  public postError(err: unknown): void {
    this.post({ type: 'agent_error', payload: { message: formatThrownValue(err) } });
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
      this.toolUpdates.clear();
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

    if (this.toolUpdates.size > 0) {
      for (const [id, update] of this.toolUpdates) {
        if (update.result || update.subtitle !== undefined) {
          void this.webview.postMessage({
            type: 'tool_execution_update',
            payload: { id, result: update.result, subagent: update.subagent, subtitle: update.subtitle },
          });
        }
        // Keep the tool name so later updates in the same tool call stay
        // append- or replace-correct; only the buffered payload is cleared.
        update.result = '';
        update.subtitle = undefined;
      }
    }
  }
}
