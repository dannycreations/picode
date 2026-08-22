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
      steer,
      shouldStopAfterTurn: undefined,
      prepareNextTurnWithContext: undefined,
    },
    sessionManager: {
      appendMessage,
    },
    settingsManager: {
      applyOverrides: vi.fn(),
    },
  } as unknown as AgentSession;
}

// Queue CRUD lives in reply-queue.spec.ts; these cover how Runtime delivers
// queued replies into a live turn through the installed session hooks.
describe('Runtime reply queue steering', () => {
  it('drains queued replies into the running session via steer on the next turn', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);

    runtime.replyQueue.add('Hello World');
    runtime.replyQueue.add('Second Message');
    runtime['bindSessionHooks'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(2);
    expect(steer.mock.calls[0][0].role).toBe('user');
    expect(steer.mock.calls[0][0].content[0].text).toBe('Hello World');
    expect(steer.mock.calls[1][0].content[0].text).toBe('Second Message');
    expect(runtime.replyQueue.all()).toEqual([]);

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

    runtime.replyQueue.add('Stays');
    runtime['bindSessionHooks'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(1);
    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Stays']);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('Runtime reply queue on settle', () => {
  const fakeEvent = (session: AgentSession) => session as unknown as Parameters<Runtime['handleSessionEvent']>[1];

  it('keeps queued replies when the run ended with an API error', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Survives');
    runtime['session'] = makeFakeSession(vi.fn());

    runtime['handleSessionEvent'](
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'boom' } as never],
        willRetry: false,
      },
      fakeEvent(runtime['session']),
    );

    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Survives']);
  });

  it('clears queued replies when the run settles without an error', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Cleared');
    runtime['session'] = makeFakeSession(vi.fn());

    runtime['handleSessionEvent']({ type: 'agent_end', messages: [], willRetry: false }, fakeEvent(runtime['session']));
    runtime['handleSessionEvent']({ type: 'agent_settled' }, fakeEvent(runtime['session']));

    expect(runtime.replyQueue.all()).toEqual([]);
  });
});

describe('Runtime cancellation persistence', () => {
  it('does not persist an assistant message aborted by a task cancel', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(vi.fn(), appendMessage);
    const runtime = new Runtime(makeFakeWebview());

    runtime['bindSessionHooks'](session);

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

    runtime['bindSessionHooks'](session);

    session.sessionManager.appendMessage!({ role: 'user', content: 'hi' } as never);

    expect(appendMessage).toHaveBeenCalledTimes(1);
  });
});
