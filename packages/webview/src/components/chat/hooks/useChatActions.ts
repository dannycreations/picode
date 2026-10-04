import { useCallback } from 'react';

import { ACTIVE_TASK_ID } from '@pi-code/shared/core/constants';
import { parseBuiltinCommand } from '@pi-code/shared/utilities/commands';
import { createActiveTask } from '@pi-code/shared/utilities/common';
import { patchMessage, resolveApproval } from '@pi-code/webview/helpers/messages';
import { selectPendingQuestion, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { Attachment, ChatMessage } from '@pi-code/shared/core/types';

interface UseChatActionsReturn {
  readonly handleSendPrompt: (text: string, attachments: Attachment[]) => void;
  readonly handleToolResponse: (msgId: string, approved: boolean) => void;
  readonly handleAnswerQuestion: (questionId: string, text: string, attachments?: Attachment[]) => void;
  readonly handleCloseTask: () => void;
  readonly handleCancelTask: () => void;
  readonly handleDeleteActiveTask: () => void;
}

function sendablePrompt(text: string, attachments: readonly Attachment[]): string | null {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  if (attachments.some((attachment) => attachment.kind === 'text')) return '(see attached text)';
  if (attachments.some((attachment) => attachment.kind === 'image')) return '(see attached image)';
  return attachments.length > 0 ? '' : null;
}

export const useChatActions = (): UseChatActionsReturn => {
  const handleAnswerQuestion = useCallback((questionId: string, text: string, attachments: Attachment[] = []): void => {
    const answer = sendablePrompt(text, attachments);
    if (answer === null) return;

    // The host reads a missing list as none, so it is only sent when there is one.
    const outgoing = attachments.length > 0 ? attachments : undefined;

    const store = useChatStore.getState();
    store.setActiveTask((prev) =>
      prev
        ? {
            ...prev,
            messages: patchMessage(prev.messages, questionId, {
              toolStatus: 'completed',
              diff: answer,
              ...(outgoing && { attachments: outgoing }),
            }),
          }
        : null,
    );
    store.setIsRunning(true);
    store.send({ type: 'question_response', question_id: questionId, text: answer, attachments: outgoing });
  }, []);

  const handleSendPrompt = useCallback(
    (text: string, attachments: Attachment[]): void => {
      const promptText = sendablePrompt(text, attachments);
      if (promptText === null) return;

      const outgoing = attachments.length > 0 ? attachments : undefined;
      const store = useChatStore.getState();
      const { activeTask, isRunning } = store;
      const pendingQuestion = selectPendingQuestion(store);

      // A pending question owns the input box: the reply answers the tool call
      // instead of starting a new turn.
      if (pendingQuestion) {
        handleAnswerQuestion(pendingQuestion.id, promptText, attachments);
        return;
      }

      // Builtin commands are executed by the extension and must not create a
      // chat bubble or start an agent run. This is parsed from the prompt text
      // itself rather than the fetched command list, so it stays correct before
      // the `init_data` response arrives.
      switch (parseBuiltinCommand(promptText)) {
        case 'reload':
          store.send({ type: 'builtin_command', command: 'reload' });
          return;
        case 'update':
          store.send({ type: 'builtin_command', command: 'update' });
          return;
        case 'compact':
          store.compact();
          return;
        case 'fork':
          store.send({ type: 'builtin_command', command: 'fork', id: '', path: activeTask?.path, title: activeTask?.title ?? '' });
          return;
      }

      // A running agent cannot take a new turn, so the reply is queued and
      // steered into the current one instead.
      if (activeTask && isRunning) {
        store.send({ type: 'add_to_reply_queue', text: promptText, attachments: outgoing });
        return;
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'user',
        text: promptText,
        attachments,
        timestamp: Date.now(),
      };

      store.setIsRunning(true);
      store.setActiveTask((prev) =>
        prev ? { ...prev, messages: [...prev.messages, userMsg] } : createActiveTask(ACTIVE_TASK_ID, promptText, [userMsg]),
      );
      store.send({
        type: 'send_message',
        text: promptText,
        path: activeTask?.path,
        attachments: outgoing,
      });
    },
    [handleAnswerQuestion],
  );

  const handleToolResponse = useCallback((msgId: string, approved: boolean): void => {
    const store = useChatStore.getState();
    store.setIsRunning(true);
    store.setActiveTask((prev) => (prev ? { ...prev, messages: resolveApproval(prev.messages, msgId, approved) } : null));
    store.send({ type: 'tool_response', approval_id: msgId, approved });
  }, []);

  const handleCancelTask = useCallback((): void => {
    useChatStore.getState().send({ type: 'cancel_task' });
  }, []);

  const handleCloseTask = useCallback((): void => {
    const store = useChatStore.getState();
    store.send({ type: 'cancel_task' });
    store.setActiveTask(null);
    store.setIsRunning(false);
  }, []);

  const handleDeleteActiveTask = useCallback((): void => {
    const store = useChatStore.getState();
    if (store.activeTask?.path) store.deleteSessions([store.activeTask.path]);
    // The host's delete_sessions handler cancels the running agent and
    // re-streams the scopes, so we only clear the local view here.
    store.setActiveTask(null);
    store.setIsRunning(false);
  }, []);

  return { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleCancelTask, handleDeleteActiveTask };
};
