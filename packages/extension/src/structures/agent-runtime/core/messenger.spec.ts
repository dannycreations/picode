import { describe, expect, it } from 'vitest';

import { Messenger } from '@pi-code/extension/structures/agent-runtime/core/messenger';

import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

function fakeWebview(): { webview: Webview; posted: ExtensionToWebviewMessage[] } {
  const posted: ExtensionToWebviewMessage[] = [];
  const webview = {
    postMessage: (message: ExtensionToWebviewMessage) => {
      posted.push(message);
      return Promise.resolve(true);
    },
  } as unknown as Webview;
  return { webview, posted };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Messenger', () => {
  it('keeps a sub-agent stream out of the task stream', async () => {
    // The task delegates the work and waits, so both streams can be live at
    // once. Their text must not end up in the same message.
    const { webview, posted } = fakeWebview();
    const messenger = new Messenger(webview);

    messenger.post({ type: 'stream_delta', payload: { text: 'task text' } });
    messenger.post({ type: 'subagent_event', payload: { toolCallId: 'call-1', event: { type: 'stream_delta', payload: { text: 'sub text' } } } });

    await wait(40);

    const deltas = posted.filter((message) => message.type === 'stream_delta' || message.type === 'subagent_event');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toEqual({ type: 'stream_delta', payload: { text: 'task text', thinking: undefined } });
    expect(deltas[1]).toEqual({
      type: 'subagent_event',
      payload: { toolCallId: 'call-1', event: { type: 'stream_delta', payload: { text: 'sub text', thinking: undefined } } },
    });

    messenger.dispose();
  });

  it('coalesces the pieces of one stream into a single message', async () => {
    const { webview, posted } = fakeWebview();
    const messenger = new Messenger(webview);

    messenger.post({ type: 'stream_delta', payload: { text: 'one ' } });
    messenger.post({ type: 'stream_delta', payload: { text: 'two' } });

    await wait(40);

    expect(posted.filter((message) => message.type === 'stream_delta')).toEqual([
      { type: 'stream_delta', payload: { text: 'one two', thinking: undefined } },
    ]);

    messenger.dispose();
  });

  it('flushes the pending text before the message that follows it', async () => {
    // The webview reads the events in order, so a delta that arrives after the
    // event that closes its row would be lost.
    const { webview, posted } = fakeWebview();
    const messenger = new Messenger(webview);

    messenger.post({ type: 'stream_delta', payload: { text: 'partial' } });
    messenger.post({ type: 'message_end', payload: {} });

    expect(posted.map((message) => message.type)).toEqual(['stream_delta', 'message_end']);

    messenger.dispose();
  });
});
