import { useCallback } from 'react';

import { ACTIVE_TASK_ID } from '@pi-code/shared/core/constants';
import { parseBuiltinCommand } from '@pi-code/shared/utilities/commands';
import { createActiveTask } from '@pi-code/shared/utilities/common';
import { patchMessage, resolveApproval } from '@pi-code/webview/components/chat/helpers/message';
import { postCompactMessage, vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ActiveTaskState, ChatMessage } from '@pi-code/shared/core/types';

interface UseChatActionsProps {
  readonly activeTask: ActiveTaskState | null;
  readonly pendingQuestion: ChatMessage | undefined;
  readonly isAgentRunning: boolean;
  readonly setActiveTask: Dispatch<SetStateAction<ActiveTaskState | null>>;
  readonly setIsAgentRunning: Dispatch<SetStateAction<boolean>>;
  readonly deleteSessions: (paths: string[]) => void;
}

interface UseChatActionsReturn {
  readonly handleSendPrompt: (text: string, images: string[]) => void;
  readonly handleToolResponse: (msgId: string, approved: boolean) => void;
  readonly handleAnswerQuestion: (questionId: string, text: string) => void;
  readonly handleCloseTask: () => void;
  readonly handleCancelTask: () => void;
  readonly handleDeleteActiveTask: () => void;
}

export const useChatActions = (params: UseChatActionsProps): UseChatActionsReturn => {
  const { activeTask, pendingQuestion, isAgentRunning, setActiveTask, setIsAgentRunning, deleteSessions } = params;

  const handleAnswerQuestion = useCallback(
    (questionId: string, text: string): void => {
      const answer = text.trim();
      if (!answer) return;

      // Settle the card optimistically so the suggestions stop accepting clicks
      // while the tool result travels back from the extension host.
      setActiveTask((prev) =>
        prev ? { ...prev, messages: patchMessage(prev.messages, questionId, { toolStatus: 'completed', diff: answer }) } : null,
      );
      setIsAgentRunning(true);
      vscode?.postMessage({ type: 'question_response', question_id: questionId, text: answer });
    },
    [setActiveTask, setIsAgentRunning],
  );

  const handleSendPrompt = useCallback(
    (text: string, images: string[]): void => {
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
        vscode?.postMessage({ type: 'builtin_command', command: 'reload' });
        return;
      }
      if (builtin === 'compact') {
        postCompactMessage(activeTask);
        return;
      }
      if (builtin === 'update') {
        vscode?.postMessage({ type: 'builtin_command', command: 'update' });
        return;
      }

      // A running agent cannot take a new turn, so the reply is queued and
      // steered into the current one instead.
      if (activeTask && isAgentRunning) {
        vscode?.postMessage({ type: 'add_to_reply_queue', text, images: images.length > 0 ? images : undefined });
        return;
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'user',
        text,
        images: images.length > 0 ? images : undefined,
        ts: Date.now(),
      };

      setIsAgentRunning(true);
      setActiveTask((prev) => (prev ? { ...prev, messages: [...prev.messages, userMsg] } : createActiveTask(ACTIVE_TASK_ID, text, [userMsg])));
      vscode?.postMessage({
        type: 'send_message',
        text,
        path: activeTask?.path,
        images,
      });
    },
    [pendingQuestion, handleAnswerQuestion, activeTask, setActiveTask, setIsAgentRunning, isAgentRunning],
  );

  const handleToolResponse = useCallback(
    (msgId: string, approved: boolean): void => {
      setIsAgentRunning(true);
      setActiveTask((prev) => (prev ? { ...prev, messages: resolveApproval(prev.messages, msgId, approved) } : null));
      vscode?.postMessage({ type: 'tool_response', approval_id: msgId, approved });
    },
    [setActiveTask, setIsAgentRunning],
  );

  const handleCancelTask = useCallback((): void => {
    vscode?.postMessage({ type: 'cancel_task' });
  }, []);

  const handleCloseTask = useCallback((): void => {
    handleCancelTask();
    setActiveTask(null);
    setIsAgentRunning(false);
  }, [handleCancelTask, setActiveTask, setIsAgentRunning]);

  const handleDeleteActiveTask = useCallback((): void => {
    if (activeTask?.path) {
      deleteSessions([activeTask.path]);
    }
    handleCloseTask();
  }, [activeTask, deleteSessions, handleCloseTask]);

  return { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleCancelTask, handleDeleteActiveTask };
};
