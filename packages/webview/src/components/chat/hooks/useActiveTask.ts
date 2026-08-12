import { useCallback, useMemo, useState } from 'react';

import { ACTIVE_TASK_ID } from '@pi-code/shared/core/protocol';
import { createActiveTask, EMPTY_STATS, patchLastAssistant, patchMessage } from '@pi-code/webview/components/chat/helpers/message';
import { findPendingQuestion } from '@pi-code/webview/components/chat/helpers/question';

import type { ActiveTaskState, ChatMessage, ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

interface ApiRequestSettlePatch {
  readonly cost?: number;
  readonly error?: string;
}

function settlePendingApiRequests(messages: ChatMessage[], patch: ApiRequestSettlePatch = {}): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.sender !== 'api_request' || m.toolStatus !== 'running') return m;
    changed = true;
    return {
      ...m,
      toolStatus: patch.error ? ('denied' as const) : ('completed' as const),
      cost: patch.cost ?? m.cost,
      errorMessage: patch.error ?? m.errorMessage,
    };
  });
  return changed ? next : messages;
}

// A turn can end while an assistant row is still marked running (error, abort,
// or a tool-only turn), so close those out alongside the API request rows.
function settleTurn(messages: ChatMessage[], patch?: ApiRequestSettlePatch): ChatMessage[] {
  return settlePendingApiRequests(messages, patch).map((m) =>
    m.sender === 'assistant' && m.toolStatus === 'running' ? { ...m, toolStatus: 'completed' as const } : m,
  );
}

// Approval and execution events for the same tool call arrive in either order,
// so the row is created on first sight and patched afterwards.
function upsertToolMessage(messages: ChatMessage[], id: string, patch: Partial<ChatMessage>): ChatMessage[] {
  if (messages.some((m) => m.id === id)) {
    return patchMessage(messages, id, patch);
  }
  return [...messages, { id, sender: 'tool', text: '', ts: Date.now(), ...patch }];
}

function appendOnce(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((m) => m.id === message.id)) return messages;

  // Consecutive identical notices are collapsed into the first one.
  const last = messages[messages.length - 1];
  if (last?.sender === message.sender && (last.errorMessage ?? last.text) === (message.errorMessage ?? message.text)) {
    return messages;
  }

  return [...messages, message];
}

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
          setActiveTask({ ...EMPTY_STATS, ...msg.payload });
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
            ...settlePendingApiRequests(messages),
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
              : [...settlePendingApiRequests(messages), { id, sender: 'api_request', text: 'API Request', ts: timestamp, toolStatus: 'running' }],
          );
          break;
        }

        case 'api_request_end': {
          const { id, cost, error, stats } = msg.payload;
          updateTask((prev) => {
            const target = prev.messages.find((m) => m.id === id && m.sender === 'api_request');
            let messages = target
              ? patchMessage(prev.messages, id, {
                  toolStatus: error ? 'denied' : 'completed',
                  cost: cost ?? target.cost,
                  errorMessage: error ?? target.errorMessage,
                })
              : settlePendingApiRequests(prev.messages, { cost, error });

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
            messages: patchLastAssistant(settlePendingApiRequests(prev.messages, { cost }), (message) => ({
              toolStatus: 'completed',
              cost: cost ?? message.cost,
            })),
            ...stats,
          }));
          break;
        }

        case 'stream_delta': {
          const { text, thinking } = msg.payload;
          updateMessages((messages) =>
            patchLastAssistant(settlePendingApiRequests(messages), (message) => ({
              text: text ? message.text + text : message.text,
              reasoning: thinking ? (message.reasoning || '') + thinking : message.reasoning,
            })),
          );
          break;
        }

        case 'tool_approval_request': {
          const { id, tool_name, arguments: toolArgs, subagent } = msg.payload;
          updateMessages((messages) =>
            upsertToolMessage(messages, id, { text: tool_name, toolName: tool_name, toolArgs, toolStatus: 'approval', subagent }),
          );
          break;
        }

        case 'tool_execution_start': {
          const { id, tool_name, arguments: toolArgs } = msg.payload;
          setIsAgentRunning(true);
          updateMessages((messages) => upsertToolMessage(messages, id, { text: tool_name, toolName: tool_name, toolArgs, toolStatus: 'running' }));
          break;
        }

        case 'tool_execution_update': {
          const { id, result } = msg.payload;
          updateMessages((messages) => patchMessage(messages, id, { diff: result }));
          break;
        }

        case 'tool_execution_end': {
          const { id, result, todos, files, is_error } = msg.payload;
          updateMessages((messages) =>
            patchMessage(messages, id, {
              todos,
              files,
              toolStatus: is_error ? 'denied' : 'completed',
              diff: is_error ? undefined : result,
            }),
          );
          break;
        }

        case 'agent_error': {
          const { message } = msg.payload;
          setIsAgentRunning(false);
          updateMessages((messages) =>
            appendOnce(settleTurn(messages, { error: message }), {
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
          updateTask((prev) => ({ ...prev, messages: settleTurn(prev.messages), ...msg.payload }));
          break;

        case 'info': {
          const { text } = msg.payload;
          const notice: ChatMessage = { id: crypto.randomUUID(), sender: 'info', text, ts: Date.now() };
          setActiveTask((prev) =>
            prev ? { ...prev, messages: appendOnce(prev.messages, notice) } : createActiveTask(ACTIVE_TASK_ID, 'Pi', [notice]),
          );
          break;
        }
      }
    },
    [updateMessages, updateTask],
  );

  return { activeTask, isAgentRunning, setActiveTask, setIsAgentRunning, pendingQuestion, onMessage };
};
