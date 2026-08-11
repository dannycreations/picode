import { useCallback } from 'react';

import { parseBuiltinCommand } from '@pi-code/shared/utilities/commands';
import { EMPTY_STATS } from '@pi-code/webview/components/chat/hooks/useActiveTask';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ActiveTaskState, ChatMessage, HistoryItem, ModelItem } from '@pi-code/shared/core/protocol';

interface UseChatActionsProps {
  readonly activeTask: ActiveTaskState | null;
  readonly models: ModelItem[];
  readonly selectedModel: string;
  readonly pendingQuestion: ChatMessage | undefined;
  readonly isAgentRunning: boolean;
  readonly setActiveTask: Dispatch<SetStateAction<ActiveTaskState | null>>;
  readonly setIsAgentRunning: Dispatch<SetStateAction<boolean>>;
  readonly setPastTasks: Dispatch<SetStateAction<HistoryItem[]>>;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UseChatActionsReturn {
  readonly handleSendPrompt: (text: string, images: string[]) => void;
  readonly handleToolResponse: (msgId: string, status: 'running' | 'denied', actionType: 'approve_tool' | 'deny_tool') => void;
  readonly handleAnswerQuestion: (questionId: string, text: string) => void;
  readonly handleCopyToInput: (text: string) => void;
  readonly handleCloseTask: () => void;
  readonly handleDeleteActiveTask: () => void;
}

export const useChatActions = (params: UseChatActionsProps): UseChatActionsReturn => {
  const {
    activeTask,
    models,
    selectedModel,
    pendingQuestion,
    isAgentRunning,
    setActiveTask,
    setIsAgentRunning,
    setPastTasks,
    setInputValue,
    textareaRef,
  } = params;

  const handleAnswerQuestion = useCallback(
    (questionId: string, text: string): void => {
      const answer = text.trim();
      if (!answer) return;

      // Settle the card optimistically so the suggestions stop accepting clicks
      // while the tool result travels back from the extension host.
      setActiveTask((prev) =>
        prev ? { ...prev, messages: prev.messages.map((m) => (m.id === questionId ? { ...m, toolStatus: 'completed', diff: answer } : m)) } : null,
      );
      setIsAgentRunning(true);
      vscode?.postMessage({ type: 'question_response', question_id: questionId, text: answer });
    },
    [setActiveTask, setIsAgentRunning],
  );

  const handleCopyToInput = useCallback(
    (text: string): void => {
      setInputValue((prev) => (prev ? `${prev}\n${text}` : text));
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [setInputValue, textareaRef],
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
        vscode?.postMessage({ type: 'reload' });
        return;
      }
      if (builtin === 'compact') {
        vscode?.postMessage({
          type: 'compact',
          id: activeTask?.id ?? '',
          path: activeTask?.path,
          title: activeTask?.title ?? '',
        });
        return;
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'user',
        text,
        images: images.length > 0 ? images : undefined,
        ts: Date.now(),
      };

      const selectedProvider = models.find((m) => m.id === selectedModel)?.provider;

      if (!activeTask) {
        setIsAgentRunning(true);
        setActiveTask({
          id: 'task-active',
          title: text,
          messages: [userMsg],
          ...EMPTY_STATS,
        });
        vscode?.postMessage({ type: 'start_new_task', text, model_id: selectedModel, model_provider: selectedProvider, images });
      } else {
        if (isAgentRunning) {
          vscode?.postMessage({
            type: 'add_to_reply_queue',
            text,
            images: images.length > 0 ? images : undefined,
          });
        } else {
          setIsAgentRunning(true);
          setActiveTask((prev) => (prev ? { ...prev, messages: [...prev.messages, userMsg] } : null));
          vscode?.postMessage({
            type: 'send_message',
            text,
            path: activeTask.path,
            model_id: selectedModel,
            model_provider: selectedProvider,
            images,
          });
        }
      }
    },
    [pendingQuestion, handleAnswerQuestion, models, selectedModel, activeTask, setActiveTask, setIsAgentRunning, isAgentRunning],
  );

  const handleToolResponse = useCallback(
    (msgId: string, status: 'running' | 'denied', actionType: 'approve_tool' | 'deny_tool'): void => {
      setIsAgentRunning(true);
      setActiveTask((prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === msgId ? { ...m, toolStatus: status } : m)) } : null));
      vscode?.postMessage({ type: actionType, approval_id: msgId });
    },
    [setActiveTask, setIsAgentRunning],
  );

  const handleCloseTask = useCallback((): void => {
    vscode?.postMessage({ type: 'close_task' });
    setActiveTask(null);
    setIsAgentRunning(false);
  }, [setActiveTask, setIsAgentRunning]);

  const handleDeleteActiveTask = useCallback((): void => {
    if (!activeTask) return;
    if (activeTask.path) {
      const deletedPath = activeTask.path;
      setPastTasks((prev) => prev.filter((item) => item.path !== deletedPath));
      vscode?.postMessage({ type: 'delete_sessions', paths: [deletedPath] });
    }
    vscode?.postMessage({ type: 'close_task' });
    setActiveTask(null);
    setIsAgentRunning(false);
  }, [activeTask, setPastTasks, setActiveTask, setIsAgentRunning]);

  return { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCopyToInput, handleCloseTask, handleDeleteActiveTask };
};
