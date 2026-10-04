import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/reminder';

import type { AgentTurnDecision } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

interface SessionHookServices {
  readonly isDisposed: () => boolean;
  readonly prepareTurn: (session: AgentSession) => Promise<void>;
  readonly isContextAboveThreshold: (session: AgentSession) => boolean;
  readonly requestCompaction: () => Promise<void>;
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

  // The agent loop treats an errored or aborted turn as a hard exit and ignores
  // the decision made there, so those turns skip the threshold check: the
  // request must not fire off a compaction for a turn the loop is about to drop.
  const baseFinishTurn = session.agent.finishTurn;
  session.agent.finishTurn = async (turn, signal): Promise<AgentTurnDecision | undefined> => {
    const isHardExit = turn.message.stopReason === 'error' || turn.message.stopReason === 'aborted';
    if (services.isDisposed() || signal?.aborted) {
      return { action: 'end' };
    }
    if (!isHardExit && services.isContextAboveThreshold(session)) {
      void services.requestCompaction();
      return { action: 'end' };
    }
    return (await baseFinishTurn?.(turn, signal)) ?? undefined;
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
