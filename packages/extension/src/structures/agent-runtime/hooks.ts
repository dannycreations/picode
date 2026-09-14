import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/reminder';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

interface SessionHookServices {
  readonly isDisposed: () => boolean;
  readonly prepareTurn: (session: AgentSession) => Promise<void>;
  readonly isContextAboveThreshold: (session: AgentSession) => boolean;
  readonly requestCompaction: (session: AgentSession) => Promise<void>;
  readonly contextPrepared: (session: AgentSession) => Promise<void>;
}

export function initSessionHooks(session: AgentSession, services: SessionHookServices): void {
  const sessionManager = session.sessionManager;
  const baseAppendMessage = sessionManager.appendMessage.bind(sessionManager);
  sessionManager.appendMessage = (message): string => {
    if (message.role === 'assistant' && (message.stopReason === 'aborted' || message.errorMessage?.includes('aborted')) && services.isDisposed()) {
      return uuidv7();
    }
    return baseAppendMessage(message);
  };

  const baseShouldStop = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = async (context, signal): Promise<boolean> => {
    if (services.isDisposed() || signal?.aborted) {
      return true;
    }
    if (services.isContextAboveThreshold(session)) {
      void services.requestCompaction(session);
      return true;
    }
    return baseShouldStop?.(context) ?? false;
  };

  const basePrepareContext = session.agent.prepareNextTurnWithContext;
  session.agent.prepareNextTurnWithContext = async (context, signal) => {
    await services.prepareTurn(session);
    await services.contextPrepared(session);

    const snapshot = await basePrepareContext?.(context, signal);
    const baseContext = snapshot?.context ?? context.context;
    if (baseContext?.messages) {
      const settings = readAppSettings();
      const todoList = settings.enableTodoTool ? getLatestTodoList(context.context.messages) : undefined;
      const messages = withTodoProgress(baseContext.messages, todoList);
      return { ...(snapshot ?? {}), context: { ...baseContext, messages } };
    }
    return snapshot;
  };
}
