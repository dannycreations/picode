import { useCallback } from 'react';

import { ACTIVE_TASK_ID } from '@pi-code/shared/core/constants';
import { parseBuiltinCommand } from '@pi-code/shared/utilities/commands';
import { createActiveTask } from '@pi-code/shared/utilities/common';
import { patchMessage, resolveApproval } from '@pi-code/webview/components/chat/helpers/message';
import { selectPendingQuestion, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ChatMessage } from '@pi-code/shared/core/types';

interface UseChatActionsReturn {
  readonly handleSendPrompt: (text: string, images: string[]) => void;
  readonly handleToolResponse: (msgId: string, approved: boolean) => void;
  readonly handleAnswerQuestion: (questionId: string, text: string) => void;
  readonly handleCloseTask: () => void;
  readonly handleCancelTask: () => void;
  readonly handleDeleteActiveTask: () => void;
}

export const useChatActions = (): UseChatActionsReturn => {
  const handleAnswerQuestion = useCallback((questionId: string, text: string): void => {
    const answer = text.trim();
    if (!answer) return;

    const store = useChatStore.getState();
    store.setActiveTask((prev) =>
      prev ? { ...prev, messages: patchMessage(prev.messages, questionId, { toolStatus: 'completed', diff: answer }) } : null,
    );
    store.setIsAgentRunning(true);
    store.questionResponse(questionId, answer);
  }, []);

  const handleSendPrompt = useCallback(
    (text: string, images: string[]): void => {
      text = text.trim();
      const store = useChatStore.getState();
      const { activeTask, isAgentRunning } = store;
      const pendingQuestion = selectPendingQuestion(store);

      // A pending question owns the input box: the reply answers the tool call
      // instead of starting a new turn.
      if (pendingQuestion) {
        handleAnswerQuestion(pendingQuestion.id, text);
        return;
      }

      // Builtin commands are executed by the extension and must not create a
      // chat bubble or start an agent run. This is parsed from the text itself
      // rather than the fetched command list, so it stays correct before the
      // `init_data` response arrives.
      const builtin = parseBuiltinCommand(text);
      if (builtin === 'reload') {
        store.reloadCatalog();
        return;
      }
      if (builtin === 'compact') {
        store.compact();
        return;
      }
      if (builtin === 'update') {
        store.updateCatalog();
        return;
      }

      // A running agent cannot take a new turn, so the reply is queued and
      // steered into the current one instead.
      if (activeTask && isAgentRunning) {
        store.addToReplyQueue(text, images);
        return;
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'user',
        text,
        images: images.length > 0 ? images : undefined,
        ts: Date.now(),
      };

      store.setIsAgentRunning(true);
      store.setActiveTask((prev) => (prev ? { ...prev, messages: [...prev.messages, userMsg] } : createActiveTask(ACTIVE_TASK_ID, text, [userMsg])));
      store.sendMessage(text, activeTask?.path, images);
    },
    [handleAnswerQuestion],
  );

  const handleToolResponse = useCallback((msgId: string, approved: boolean): void => {
    const store = useChatStore.getState();
    store.setIsAgentRunning(true);
    store.setActiveTask((prev) => (prev ? { ...prev, messages: resolveApproval(prev.messages, msgId, approved) } : null));
    store.toolResponse(msgId, approved);
  }, []);

  const handleCancelTask = useCallback((): void => {
    useChatStore.getState().cancelTask();
  }, []);

  const handleCloseTask = useCallback((): void => {
    const store = useChatStore.getState();
    store.cancelTask();
    store.setActiveTask(null);
    store.setIsAgentRunning(false);
  }, []);

  const handleDeleteActiveTask = useCallback((): void => {
    const store = useChatStore.getState();
    if (store.activeTask?.path) store.deleteSessions([store.activeTask.path]);
    // The host's delete_sessions handler cancels the running agent and
    // re-streams the scopes, so we only clear the local view here.
    store.setActiveTask(null);
    store.setIsAgentRunning(false);
  }, []);

  return { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleCancelTask, handleDeleteActiveTask };
};
