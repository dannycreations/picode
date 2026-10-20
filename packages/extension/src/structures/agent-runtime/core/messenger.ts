import { formatThrownValue } from '@earendil-works/pi-ai';

import { logger } from '@pi-code/shared/core/logger';

import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

const FLUSH_INTERVAL_MS = 16;

export function postToWebview(webview: Webview | null, message: ExtensionToWebviewMessage): void {
  const sent = webview?.postMessage(message);
  if (sent) {
    void Promise.resolve(sent).catch((err) => logger.error('Failed to post webview message:', err));
  }
}

function joinChunks(chunks: readonly string[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0];
  return chunks.join('');
}

interface CoalescedToolUpdate {
  toolName?: string;
  chunks: string[];
  subagent?: string;
  subtitle?: string;
}

export class Messenger {
  private isDisposed = false;
  private textChunks: string[] = [];
  private thinkingChunks: string[] = [];
  private toolUpdates = new Map<string, CoalescedToolUpdate>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private webview: Webview | null;

  public constructor(webview: Webview) {
    this.webview = webview;
  }

  public post(message: ExtensionToWebviewMessage): void {
    if (this.isDisposed) {
      return;
    }

    if (message.type === 'stream_delta') {
      if (message.payload.text) this.textChunks.push(message.payload.text);
      if (message.payload.thinking) this.thinkingChunks.push(message.payload.thinking);
      this.scheduleFlush();
      return;
    }

    // Sub-agent events arrive through this same messenger; their start/update/
    // end events mirror the main-agent tool lifecycle below.
    if (message.type === 'tool_execution_start') {
      const entry = this.toolUpdates.get(message.payload.id) ?? { chunks: [], subagent: undefined, subtitle: undefined };
      entry.toolName = message.payload.tool_name;
      this.toolUpdates.set(message.payload.id, entry);
      this.send(message);
      return;
    }

    if (message.type === 'tool_execution_update') {
      const { id, result, subagent, subtitle } = message.payload;
      const entry = this.toolUpdates.get(id) ?? { toolName: undefined, chunks: [], subagent: undefined, subtitle: undefined };
      // A command reports its output in pieces that belong together, so they
      // pile up; every other tool reports one result that replaces the last.
      if (entry.toolName === 'execute_command') {
        entry.chunks.push(result);
      } else {
        entry.chunks.length = 0;
        entry.chunks.push(result);
      }
      entry.subagent = subagent ?? entry.subagent;
      entry.subtitle = subtitle ?? entry.subtitle;
      this.toolUpdates.set(id, entry);
      this.scheduleFlush();
      return;
    }

    if (message.type === 'tool_execution_end') {
      this.toolUpdates.delete(message.payload.id);
      this.send(message);
      return;
    }

    this.send(message);
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

  private send(message: ExtensionToWebviewMessage): void {
    this.flush();
    postToWebview(this.webview, message);
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.isDisposed) {
      this.textChunks.length = 0;
      this.thinkingChunks.length = 0;
      this.toolUpdates.clear();
      return;
    }

    if (this.textChunks.length > 0 || this.thinkingChunks.length > 0) {
      postToWebview(this.webview, {
        type: 'stream_delta',
        payload: {
          text: joinChunks(this.textChunks) || undefined,
          thinking: joinChunks(this.thinkingChunks) || undefined,
        },
      });
      this.textChunks.length = 0;
      this.thinkingChunks.length = 0;
    }

    if (this.toolUpdates.size > 0) {
      for (const [id, update] of this.toolUpdates) {
        const result = joinChunks(update.chunks);
        if (result || update.subtitle !== undefined) {
          postToWebview(this.webview, {
            type: 'tool_execution_update',
            payload: { id, result, subagent: update.subagent, subtitle: update.subtitle },
          });
        }
        // Keep the tool name so later updates in the same tool call stay
        // append- or replace-correct; only the buffered payload is cleared.
        update.chunks.length = 0;
        update.subtitle = undefined;
      }
    }
  }
}
