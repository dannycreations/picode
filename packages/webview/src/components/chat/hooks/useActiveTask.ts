import { useCallback, useMemo, useState } from 'react';

import {
  appendOnce,
  deliverQueuedReplies,
  ignoreUnknownSubagent,
  patchLastAssistant,
  patchMessage,
  settlePendingTurns,
  upsertToolMessage,
} from '@pi-code/webview/components/chat/helpers/message';
import { findPendingQuestion } from '@pi-code/webview/components/chat/helpers/question';

import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { ActiveTaskState, ChatMessage } from '@pi-code/shared/core/types';

interface UseActiveTaskReturn {
  readonly activeTask: ActiveTaskState | null;
  readonly isAgentRunning: boolean;
  readonly setActiveTask: React.Dispatch<React.SetStateAction<ActiveTaskState | null>>;
  readonly setIsAgentRunning: React.Dispatch<React.SetStateAction<boolean>>;
  readonly pendingQuestion: ChatMessage | undefined;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useActiveTask = (): UseActiveTaskReturn => {
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const pendingQuestion = useMemo(() => findPendingQuestion(activeTask?.messages ?? []), [activeTask?.messages]);

  // Every stream event patches the task that is already open; there is nothing
  // to update before a session is loaded.
  const updateTask = useCallback((update: (task: ActiveTaskState) => ActiveTaskState): void => {
    setActiveTask((prev) => (prev ? update(prev) : null));
  }, []);

  const updateMessages = useCallback(
    (update: (messages: ChatMessage[]) => ChatMessage[]): void => {
      updateTask((prev) => ({ ...prev, messages: update(prev.messages) }));
    },
    [updateTask],
  );

  const onMessage = useCallback(
    (msg: ExtensionToWebviewMessage): void => {
      switch (msg.type) {
        case 'session_loaded': {
          setActiveTask(msg.payload);
          setIsAgentRunning(false);
          break;
        }

        case 'reply_queue_data': {
          const queued: ChatMessage[] = msg.payload.queue.map((q) => ({
            id: q.id,
            sender: 'queue',
            text: q.text,
            images: q.images,
            ts: q.ts,
          }));
          updateMessages((messages) => [...messages.filter((m) => m.sender !== 'queue'), ...queued]);
          break;
        }

        case 'reply_queue_delivered': {
          updateMessages((messages) => deliverQueuedReplies(messages, msg.payload.messages));
          break;
        }

        case 'compaction_end':
          updateTask((prev) => ({ ...prev, ...msg.payload }));
          break;

        case 'agent_start': {
          const { path, stats } = msg.payload;
          setIsAgentRunning(true);
          updateTask((prev) => ({ ...prev, path: path ?? prev.path, ...stats }));
          break;
        }

        case 'message_start': {
          const { timestamp } = msg.payload;
          setIsAgentRunning(true);
          updateMessages((messages) => [
            ...settlePendingTurns(messages),
            { id: `assistant-${timestamp}`, sender: 'assistant', text: '', ts: timestamp, toolStatus: 'running' },
          ]);
          break;
        }

        case 'api_request_start': {
          const { id, timestamp } = msg.payload;
          setIsAgentRunning(true);
          updateMessages((messages) =>
            messages.some((m) => m.id === id)
              ? messages
              : [...settlePendingTurns(messages), { id, sender: 'api_request', text: 'API Request', ts: timestamp, toolStatus: 'running' }],
          );
          break;
        }

        case 'api_request_end': {
          const { id, cost, error, stats } = msg.payload;
          updateTask((prev) => {
            const target = prev.messages.find((m) => m.id === id && m.sender === 'api_request');
            let messages = target
              ? patchMessage(prev.messages, id, {
                  toolStatus: error ? 'denied' : 'running',
                  cost: cost ?? target.cost,
                  errorMessage: error ?? target.errorMessage,
                })
              : settlePendingTurns(prev.messages, { cost, error });

            if (error) {
              messages = appendOnce(messages, { id: `${id}-error`, sender: 'error', text: error, errorMessage: error, ts: Date.now() });
            }

            return { ...prev, messages, ...stats };
          });
          break;
        }

        case 'message_end': {
          const { cost, stats } = msg.payload;
          updateTask((prev) => ({
            ...prev,
            messages: patchLastAssistant(prev.messages, (message) => ({
              toolStatus: 'running',
              cost: cost ?? message.cost,
            })),
            ...stats,
          }));
          break;
        }

        case 'stream_delta': {
          const { text, thinking } = msg.payload;
          updateMessages((messages) =>
            patchLastAssistant(messages, (message) => ({
              text: text ? message.text + text : message.text,
              reasoning: thinking ? (message.reasoning || '') + thinking : message.reasoning,
            })),
          );
          break;
        }

        case 'tool_approval_request': {
          const { id, tool_name, arguments: toolArgs, subagent, parentToolCallId } = msg.payload;
          updateMessages((messages) =>
            upsertToolMessage(settlePendingTurns(messages), id, {
              text: tool_name,
              toolName: tool_name,
              toolArgs,
              toolStatus: 'approval',
              subagent,
              parentToolCallId,
            }),
          );
          break;
        }

        case 'tool_execution_start': {
          const { id, tool_name, arguments: toolArgs, subagent } = msg.payload;
          setIsAgentRunning(true);
          updateMessages((messages) => {
            if (ignoreUnknownSubagent(messages, subagent, id)) return messages;
            return upsertToolMessage(settlePendingTurns(messages), id, {
              text: tool_name,
              toolName: tool_name,
              toolArgs,
              toolStatus: 'running',
              subagent,
            });
          });
          break;
        }

        case 'tool_execution_update': {
          const { id, result, subagent } = msg.payload;
          updateMessages((messages) => {
            if (ignoreUnknownSubagent(messages, subagent, id)) return messages;
            const target = messages.find((m) => m.id === id);
            // Command output streams in chunks, so append each delta to the
            // running preview instead of replacing it like the discrete tools.
            if (target?.toolName === 'execute_command') {
              return patchMessage(messages, id, { diff: `${target.diff ?? ''}${result}` });
            }
            return patchMessage(messages, id, { diff: result });
          });
          break;
        }

        case 'tool_execution_end': {
          const { id, result, todos, files, is_error, subagent } = msg.payload;
          updateMessages((messages) => {
            if (ignoreUnknownSubagent(messages, subagent, id)) {
              return messages;
            }
            const existing = messages.find((m) => m.id === id);
            const duration = existing ? Math.max(0, Math.round((Date.now() - existing.ts) / 1000)) : undefined;
            return patchMessage(messages, id, {
              todos,
              files,
              toolStatus: is_error ? 'denied' : 'completed',
              diff: result,
              duration,
            });
          });
          break;
        }

        case 'agent_error': {
          const { message } = msg.payload;
          setIsAgentRunning(false);
          updateMessages((messages) =>
            appendOnce(settlePendingTurns(messages, { error: message }), {
              id: crypto.randomUUID(),
              sender: 'error',
              text: message,
              errorMessage: message,
              ts: Date.now(),
            }),
          );
          break;
        }

        case 'agent_settled':
          setIsAgentRunning(false);
          updateTask((prev) => ({ ...prev, messages: settlePendingTurns(prev.messages), ...msg.payload }));
          break;

        case 'archive_result': {
          const { path, archived } = msg.payload;
          // updateTask already no-ops when there is no active task.
          updateTask((prev) => ({ ...prev, path, isArchived: archived }));
          break;
        }
      }
    },
    [updateMessages, updateTask],
  );

  return { activeTask, isAgentRunning, setActiveTask, setIsAgentRunning, pendingQuestion, onMessage };
};
