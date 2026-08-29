import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/reminder';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

interface SessionHookServices {
  readonly isTaskCancelled: () => boolean;
  readonly prepareTurn: (session: AgentSession) => Promise<void>;
  readonly contextPrepared: (session: AgentSession) => Promise<AgentMessage[]>;
}

export function initSessionHooks(session: AgentSession, services: SessionHookServices): void {
  const sessionManager = session.sessionManager;
  const baseAppendMessage = sessionManager.appendMessage.bind(sessionManager);
  sessionManager.appendMessage = (message): string => {
    // Ignore the "Request aborted" assistant entry written by cancelTask().
    if (services.isTaskCancelled() && message.role === 'assistant' && message.stopReason === 'aborted') {
      return uuidv7();
    }
    return baseAppendMessage(message);
  };

  const baseShouldStop = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = (context, signal): boolean | Promise<boolean> => {
    if (services.isTaskCancelled() || signal?.aborted) return true;
    return baseShouldStop?.(context) ?? false;
  };

  const basePrepareContext = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (context, signal) => {
    await services.prepareTurn(session);

    const snapshot = await basePrepareContext?.(context, signal);
    const mentions = await services.contextPrepared(session);

    const baseContext = snapshot?.context ?? context.context;
    if (baseContext?.messages) {
      const settings = readAppSettings();
      const contextMessages = mentions.length > 0 ? [...baseContext.messages, ...mentions] : baseContext.messages;
      const todoList = settings.enableTodoTool ? getLatestTodoList(context.context.messages) : undefined;
      const messages = withTodoProgress(contextMessages, todoList);
      return { ...(snapshot ?? {}), context: { ...baseContext, messages } };
    }
    return snapshot;
  };
}
