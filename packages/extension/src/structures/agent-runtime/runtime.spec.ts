import { describe, expect, it, vi } from 'vitest';

import { Runtime } from '@pi-code/extension/structures/agent-runtime/runtime';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';

vi.mock('@pi-code/extension/core/settings', () => ({
  getSettingsManager: () => ({
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getDefaultThinkingLevel: () => undefined,
  }),
  readAppSettings: () => ({ enableTodoTool: false }),
}));

function makeFakeWebview(): Webview {
  return { postMessage: vi.fn() } as unknown as Webview;
}

function makeFakeSession(steer: () => void, appendMessage: ReturnType<typeof vi.fn> = vi.fn(() => 'persisted-id')): AgentSession {
  return {
    agent: {
      prepareNextTurnWithContext: undefined,
      steer,
    },
    sessionManager: {
      appendMessage,
    },
    settingsManager: {
      applyOverrides: vi.fn(),
    },
  } as unknown as AgentSession;
}

describe('Runtime reply queue', () => {
  it('adds, edits, removes, and clears reply queue messages', () => {
    const runtime = new Runtime(makeFakeWebview());

    expect(runtime['replyQueue']).toEqual([]);

    runtime.addToReplyQueue('Hello World');
    expect(runtime['replyQueue'].length).toBe(1);
    expect(runtime['replyQueue'][0].text).toBe('Hello World');

    const msgId = runtime['replyQueue'][0].id;

    runtime.editReplyQueue(msgId, 'Hello Edited');
    expect(runtime['replyQueue'][0].text).toBe('Hello Edited');

    runtime.addToReplyQueue('Second Message');
    expect(runtime['replyQueue'].length).toBe(2);

    runtime.removeFromReplyQueue(msgId);
    expect(runtime['replyQueue'].length).toBe(1);
    expect(runtime['replyQueue'][0].text).toBe('Second Message');

    runtime.clearReplyQueue();
    expect(runtime['replyQueue']).toEqual([]);
  });

  it('drains queued replies into the running session via steer on the next turn', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);

    runtime.addToReplyQueue('Hello World');
    runtime.addToReplyQueue('Second Message');
    runtime['setupSessionHook'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(2);
    expect(steer.mock.calls[0][0].role).toBe('user');
    expect(steer.mock.calls[0][0].content[0].text).toBe('Hello World');
    expect(steer.mock.calls[1][0].content[0].text).toBe('Second Message');
    expect(runtime['replyQueue']).toEqual([]);

    const delivered = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .find((msg) => msg.type === 'reply_queue_delivered');
    expect(delivered).toEqual({
      type: 'reply_queue_delivered',
      payload: {
        messages: [
          expect.objectContaining({ sender: 'user', text: 'Hello World' }),
          expect.objectContaining({ sender: 'user', text: 'Second Message' }),
        ],
      },
    });
  });

  it('keeps queued replies that fail to steer and retries them next turn', async () => {
    const steer = vi.fn(() => {
      throw new Error('boom');
    });
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const session = makeFakeSession(steer);
    const runtime = new Runtime(makeFakeWebview());

    runtime.addToReplyQueue('Stays');
    runtime['setupSessionHook'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(1);
    expect(runtime['replyQueue'].map((m) => m.text)).toEqual(['Stays']);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('does not persist an assistant message aborted by a task cancel', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(vi.fn(), appendMessage);
    const runtime = new Runtime(makeFakeWebview());

    runtime['setupSessionHook'](session);

    // After cancelTask, Runtime.session is null.
    runtime['session'] = null;
    session.sessionManager.appendMessage!({
      role: 'assistant',
      stopReason: 'aborted',
    } as never);

    // The wrapper short-circuits and never calls the real appendMessage.
    expect(appendMessage).toHaveBeenCalledTimes(0);
  });

  it('persists non-aborted messages through the real appendMessage', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(vi.fn(), appendMessage);
    const runtime = new Runtime(makeFakeWebview());

    runtime['setupSessionHook'](session);

    session.sessionManager.appendMessage!({ role: 'user', content: 'hi' } as never);

    expect(appendMessage).toHaveBeenCalledTimes(1);
  });
});
