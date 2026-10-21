import { formatThrownValue } from '@earendil-works/pi-ai';

import { logger } from '@pi-code/shared/core/logger';

import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage, SubagentEvent } from '@pi-code/shared/core/protocol';

const FLUSH_INTERVAL_MS = 16;
const MAIN_SCOPE = 'main';

export function postToWebview(webview: Webview | null, message: ExtensionToWebviewMessage): void {
  const sent = webview?.postMessage(message);
  if (sent) {
    sent.then(undefined, (err) => logger.error('Failed to post webview message:', err));
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

interface StreamBuffer {
  readonly text: string[];
  readonly thinking: string[];
  readonly toolUpdates: Map<string, CoalescedToolUpdate>;
}

export class Messenger {
  private isDisposed = false;
  private buffers = new Map<string, StreamBuffer>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private webview: Webview | null;

  public constructor(webview: Webview) {
    this.webview = webview;
  }

  public post(message: ExtensionToWebviewMessage): void {
    if (this.isDisposed) {
      return;
    }

    if (message.type === 'subagent_event') {
      this.postEvent(`subagent:${message.payload.toolCallId}`, message.payload.event);
      return;
    }

    this.postEvent(MAIN_SCOPE, message);
  }

  private postEvent(scope: string, event: ExtensionToWebviewMessage | SubagentEvent): void {
    const buffer = this.bufferFor(scope);

    if (event.type === 'stream_delta') {
      if (event.payload.text) buffer.text.push(event.payload.text);
      if (event.payload.thinking) buffer.thinking.push(event.payload.thinking);
      this.scheduleFlush();
      return;
    }

    // Sub-agent events arrive through this same messenger; their start/update/
    // end events mirror the main-agent tool lifecycle below.
    if (event.type === 'tool_execution_start') {
      const entry = buffer.toolUpdates.get(event.payload.id) ?? { chunks: [], subagent: undefined, subtitle: undefined };
      entry.toolName = event.payload.tool_name;
      buffer.toolUpdates.set(event.payload.id, entry);
      this.send(scope, event);
      return;
    }

    if (event.type === 'tool_execution_update') {
      const { id, result, subagent, subtitle } = event.payload;
      const entry = buffer.toolUpdates.get(id) ?? { toolName: undefined, chunks: [], subagent: undefined, subtitle: undefined };
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
      buffer.toolUpdates.set(id, entry);
      this.scheduleFlush();
      return;
    }

    if (event.type === 'tool_execution_end') {
      buffer.toolUpdates.delete(event.payload.id);
      this.send(scope, event);
      // A sub-agent that finished its last call has nothing left to coalesce.
      if (scope !== MAIN_SCOPE && buffer.toolUpdates.size === 0) this.buffers.delete(scope);
      return;
    }

    this.send(scope, event);
  }

  public postError(err: unknown): void {
    this.post({ type: 'agent_error', payload: { message: formatThrownValue(err) } });
  }

  public dispose(): void {
    this.flush();
    this.isDisposed = true;
    this.webview = null;
  }

  private bufferFor(scope: string): StreamBuffer {
    const existing = this.buffers.get(scope);
    if (existing) return existing;

    const buffer: StreamBuffer = { text: [], thinking: [], toolUpdates: new Map() };
    this.buffers.set(scope, buffer);
    return buffer;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private send(scope: string, event: ExtensionToWebviewMessage | SubagentEvent): void {
    this.flush();
    this.emit(scope, event);
  }

  private emit(scope: string, event: ExtensionToWebviewMessage | SubagentEvent): void {
    if (scope === MAIN_SCOPE) {
      postToWebview(this.webview, event as ExtensionToWebviewMessage);
      return;
    }
    postToWebview(this.webview, {
      type: 'subagent_event',
      payload: { toolCallId: scope.slice('subagent:'.length), event: event as SubagentEvent },
    });
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.isDisposed) {
      this.buffers.clear();
      return;
    }

    for (const [scope, buffer] of this.buffers) {
      const text = joinChunks(buffer.text);
      const thinking = joinChunks(buffer.thinking);
      if (text.length > 0 || thinking.length > 0) {
        this.emit(scope, {
          type: 'stream_delta',
          payload: { text: text || undefined, thinking: thinking || undefined },
        });
        buffer.text.length = 0;
        buffer.thinking.length = 0;
      }

      if (buffer.toolUpdates.size > 0) {
        for (const [id, update] of buffer.toolUpdates) {
          const result = joinChunks(update.chunks);
          if (result || update.subtitle !== undefined) {
            this.emit(scope, {
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

      // A sub-agent that has nothing left to coalesce needs no buffer.
      if (scope !== MAIN_SCOPE && buffer.text.length === 0 && buffer.thinking.length === 0 && buffer.toolUpdates.size === 0) {
        this.buffers.delete(scope);
      }
    }
  }
}
