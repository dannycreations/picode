import { describe, expect, it, vi } from 'vitest';

import { AgentRunner } from '@pi-code/extension/structures/agent-runtime/runner';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';

function makeFakeWebview(): Webview {
  return { postMessage: vi.fn() } as unknown as Webview;
}

function makeFakeSession(steer: () => void): AgentSession {
  return {
    agent: {
      prepareNextTurnWithContext: undefined,
      steer,
    },
  } as unknown as AgentSession;
}

describe('AgentRunner reply queue', () => {
  it('adds, edits, removes, and clears reply queue messages', () => {
    const runner = new AgentRunner(makeFakeWebview());

    expect(runner['replyQueue']).toEqual([]);

    runner.addToReplyQueue('Hello World');
    expect(runner['replyQueue'].length).toBe(1);
    expect(runner['replyQueue'][0].text).toBe('Hello World');

    const msgId = runner['replyQueue'][0].id;

    runner.editReplyQueue(msgId, 'Hello Edited');
    expect(runner['replyQueue'][0].text).toBe('Hello Edited');

    runner.addToReplyQueue('Second Message');
    expect(runner['replyQueue'].length).toBe(2);

    runner.removeFromReplyQueue(msgId);
    expect(runner['replyQueue'].length).toBe(1);
    expect(runner['replyQueue'][0].text).toBe('Second Message');

    runner.clearReplyQueue();
    expect(runner['replyQueue']).toEqual([]);
  });

  it('drains queued replies into the running session via steer on the next turn', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const webview = makeFakeWebview();
    const runner = new AgentRunner(webview);

    runner.addToReplyQueue('Hello World');
    runner.addToReplyQueue('Second Message');
    runner['setupSessionHook'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(2);
    expect(steer.mock.calls[0][0].role).toBe('user');
    expect(steer.mock.calls[0][0].content[0].text).toBe('Hello World');
    expect(steer.mock.calls[1][0].content[0].text).toBe('Second Message');
    expect(runner['replyQueue']).toEqual([]);

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
    const runner = new AgentRunner(makeFakeWebview());

    runner.addToReplyQueue('Stays');
    runner['setupSessionHook'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(1);
    expect(runner['replyQueue'].map((m) => m.text)).toEqual(['Stays']);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
