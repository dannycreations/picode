import { describe, expect, it, vi } from 'vitest';

import { initSessionHooks } from '@pi-code/extension/structures/agent-runtime/hooks';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: () => ({ enableTodoTool: false }),
}));

function makeFakeSession(appendMessage = vi.fn(() => 'persisted-id')): AgentSession {
  return {
    agent: {
      steer: vi.fn(),
      shouldStopAfterTurn: undefined,
      prepareNextTurnWithContext: undefined,
    },
    sessionManager: {
      appendMessage,
    },
  } as unknown as AgentSession;
}

const noopServices = {
  isTaskCancelled: () => false,
  prepareTurn: async () => {},
  contextPrepared: async () => [],
};

type ShouldStop = (context: unknown, signal?: AbortSignal) => boolean | Promise<boolean>;

describe('initSessionHooks', () => {
  it('suppresses only the aborted assistant entry while cancelled', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(appendMessage);
    let cancelled = true;

    initSessionHooks(session, {
      ...noopServices,
      isTaskCancelled: () => cancelled,
    });

    // Cancelled: the synthetic abort entry never reaches persistence.
    session.sessionManager.appendMessage!({ role: 'assistant', stopReason: 'aborted' } as never);
    expect(appendMessage).not.toHaveBeenCalled();

    // Cancelled but ordinary traffic still persists.
    session.sessionManager.appendMessage!({ role: 'user', content: 'hi' } as never);
    expect(appendMessage).toHaveBeenCalledTimes(1);

    // Not cancelled: even aborted entries persist normally.
    cancelled = false;
    session.sessionManager.appendMessage!({ role: 'assistant', stopReason: 'aborted' } as never);
    expect(appendMessage).toHaveBeenCalledTimes(2);
  });

  it('forces a turn stop when cancelled or the signal aborted, else defers to the base predicate', async () => {
    const baseShouldStop = vi.fn(() => false);
    const session = makeFakeSession();
    (session.agent as { shouldStopAfterTurn?: unknown }).shouldStopAfterTurn = baseShouldStop;
    let cancelled = false;

    initSessionHooks(session, {
      ...noopServices,
      isTaskCancelled: () => cancelled,
    });

    const stop = session.agent.shouldStopAfterTurn as unknown as ShouldStop;

    expect(stop({}, undefined)).toBe(false);

    const controller = new AbortController();
    controller.abort();
    expect(stop({}, controller.signal)).toBe(true);

    cancelled = true;
    expect(stop({}, undefined)).toBe(true);

    // Only the healthy call reached the library predicate.
    expect(baseShouldStop).toHaveBeenCalledTimes(1);
  });

  it('keeps turns running when no base predicate exists and nothing demands a stop', () => {
    const session = makeFakeSession();

    initSessionHooks(session, noopServices);

    const stop = session.agent.shouldStopAfterTurn as unknown as ShouldStop;
    expect(stop({}, new AbortController().signal)).toBe(false);
  });

  it('orders prepareTurn before the base build and contextPrepared after, then appends the todo reminder', async () => {
    const order: string[] = [];
    const basePrepare = vi.fn(async () => ({
      context: { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 }] },
    }));
    const session = makeFakeSession();
    (session.agent as { prepareNextTurnWithContext?: unknown }).prepareNextTurnWithContext = basePrepare;

    initSessionHooks(session, {
      ...noopServices,
      prepareTurn: async () => {
        order.push('prepare');
      },
      contextPrepared: async () => {
        order.push('prepared');
        return [];
      },
    });

    const result = (await session.agent.prepareNextTurnWithContext!({ context: { messages: [] } } as never, undefined)) as {
      context: { messages: Array<{ content: Array<{ text: string }> }> };
    };

    expect(order).toEqual(['prepare', 'prepared']);
    expect(basePrepare).toHaveBeenCalledTimes(1);
    expect(result.context.messages).toHaveLength(2);
    expect(result.context.messages.at(-1)?.content[0].text).toContain('Todo Reminders');
  });
});
