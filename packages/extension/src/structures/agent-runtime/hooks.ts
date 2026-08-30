import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/reminder';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

interface SessionHookServices {
  readonly isDisposed: () => boolean;
  readonly isCompacting: () => boolean;
  readonly prepareTurn: (session: AgentSession) => Promise<void>;
  readonly isContextAboveThreshold: (session: AgentSession) => boolean;
  readonly requestCompaction: (session: AgentSession) => Promise<void>;
  readonly contextPrepared: (session: AgentSession) => Promise<AgentMessage[]>;
}

export function initSessionHooks(session: AgentSession, services: SessionHookServices): void {
  const sessionManager = session.sessionManager;
  const baseAppendMessage = sessionManager.appendMessage.bind(sessionManager);
  sessionManager.appendMessage = (message): string => {
    if (message.role === 'assistant' && message.stopReason === 'aborted' && (services.isDisposed() || services.isCompacting())) {
      return uuidv7();
    }
    return baseAppendMessage(message);
  };

  const baseShouldStop = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = (context, signal): boolean | Promise<boolean> => {
    if (services.isDisposed() || signal?.aborted) return true;
    return baseShouldStop?.(context) ?? false;
  };

  const basePrepareContext = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (context, signal) => {
    // Above the threshold the next turn must not build against the bloated
    // context. Signal the compaction to abort this turn, compact, and resume.
    // Return early so we do not prepare a turn the abort will tear down.
    if (services.isContextAboveThreshold(session)) {
      void services.requestCompaction(session);
      return;
    }

    await services.prepareTurn(session);

    const liveMessages = session.messages;
    const liveContext = liveMessages ? { ...context, context: { ...context.context, messages: liveMessages } } : context;

    const snapshot = await basePrepareContext?.(liveContext, signal);
    const mentions = await services.contextPrepared(session);

    const baseContext = snapshot?.context ?? liveContext.context;
    if (baseContext?.messages) {
      const settings = readAppSettings();
      const contextMessages = mentions.length > 0 ? [...baseContext.messages, ...mentions] : baseContext.messages;
      const todoList = settings.enableTodoTool ? getLatestTodoList(liveMessages ?? context.context.messages) : undefined;
      const messages = withTodoProgress(contextMessages, todoList);
      return { ...(snapshot ?? {}), context: { ...baseContext, messages } };
    }
    return snapshot;
  };
}
