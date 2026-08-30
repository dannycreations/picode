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
  isDisposed: () => false,
  isCompacting: () => false,
  prepareTurn: async () => {},
  isContextAboveThreshold: () => false,
  requestCompaction: vi.fn(),
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
      isDisposed: () => cancelled,
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

  it('suppresses the aborted assistant entry while compacting', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(appendMessage);

    initSessionHooks(session, {
      ...noopServices,
      isDisposed: () => false,
      isCompacting: () => true,
    });

    // Compaction aborts the run but keeps the session, so isDisposed stays
    // false; the compaction flag must still drop the synthetic abort entry.
    session.sessionManager.appendMessage!({ role: 'assistant', stopReason: 'aborted' } as never);
    expect(appendMessage).not.toHaveBeenCalled();

    session.sessionManager.appendMessage!({ role: 'user', content: 'hi' } as never);
    expect(appendMessage).toHaveBeenCalledTimes(1);
  });

  it('forces a turn stop when cancelled or the signal aborted, else defers to the base predicate', async () => {
    const baseShouldStop = vi.fn(() => false);
    const session = makeFakeSession();
    (session.agent as { shouldStopAfterTurn?: unknown }).shouldStopAfterTurn = baseShouldStop;
    let cancelled = false;

    initSessionHooks(session, {
      ...noopServices,
      isDisposed: () => cancelled,
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

  it('signals compaction and skips preparation when the context is above threshold', async () => {
    const requestCompaction = vi.fn();
    const prepareTurn = vi.fn(async () => {});
    const session = makeFakeSession();
    (session.agent as { prepareNextTurnWithContext?: unknown }).prepareNextTurnWithContext = undefined;

    initSessionHooks(session, {
      ...noopServices,
      isContextAboveThreshold: () => true,
      requestCompaction,
      prepareTurn,
    });

    const result = await session.agent.prepareNextTurnWithContext!({ context: { messages: [] } } as never, undefined);

    expect(requestCompaction).toHaveBeenCalledTimes(1);
    expect(requestCompaction).toHaveBeenCalledWith(session);
    expect(prepareTurn).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('prepares the turn normally when the context is below threshold', async () => {
    const requestCompaction = vi.fn();
    const session = makeFakeSession();
    (session.agent as { prepareNextTurnWithContext?: unknown }).prepareNextTurnWithContext = undefined;

    initSessionHooks(session, { ...noopServices, requestCompaction });

    await session.agent.prepareNextTurnWithContext!({ context: { messages: [] } } as never, undefined);

    expect(requestCompaction).not.toHaveBeenCalled();
  });

  it('uses the live session messages rather than the stale passed context when below threshold', async () => {
    const session = makeFakeSession();
    const live: Array<{ role: string; content: string }> = [{ role: 'user', content: 'live' }];
    (session as unknown as { messages: typeof live }).messages = live;

    const echoBase = (turn: { context: { messages: unknown[] } }) => Promise.resolve({ context: { messages: turn.context.messages } });
    (session.agent as { prepareNextTurnWithContext?: unknown }).prepareNextTurnWithContext = echoBase;

    initSessionHooks(session, { ...noopServices });

    const result = (await session.agent.prepareNextTurnWithContext!(
      { context: { messages: [{ role: 'user', content: 'stale' }] } } as never,
      undefined,
    )) as { context: { messages: Array<{ content: string }> } };

    expect(result.context.messages[0]).toEqual({ role: 'user', content: 'live' });
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
