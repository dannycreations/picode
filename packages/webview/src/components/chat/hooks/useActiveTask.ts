import { useCallback, useMemo, useState } from 'react';

import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { findPendingQuestion } from '@pi-code/webview/components/chat/helpers/question';

import type { ActiveTaskState, ChatMessage, ExtensionToWebviewMessage, StatsData } from '@pi-code/shared/core/protocol';

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

function appendErrorMessage(messages: ChatMessage[], id: string, error: string): ChatMessage[] {
  if (messages.some((m) => m.id === id)) return messages;

  const last = messages[messages.length - 1];
  if (last?.sender === 'error' && (last.errorMessage ?? last.text) === error) return messages;

  return [...messages, { id, sender: 'error', text: error, errorMessage: error, ts: Date.now() }];
}

function appendInfoMessage(messages: ChatMessage[], id: string, text: string): ChatMessage[] {
  if (messages.some((m) => m.id === id)) return messages;

  const last = messages[messages.length - 1];
  if (last?.sender === 'info' && last.text === text) return messages;

  return [...messages, { id, sender: 'info', text, ts: Date.now() }];
}

export const EMPTY_STATS: StatsData = {
  tokensIn: 0,
  tokensOut: 0,
  cacheWrites: 0,
  cacheReads: 0,
  totalCost: 0,
  contextTokens: 0,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
};

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

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'session_loaded': {
        setActiveTask({ ...EMPTY_STATS, ...msg.payload });
        setIsAgentRunning(false);
        break;
      }

      case 'reply_queue_data': {
        const { queue } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;
          const nonQueueMessages = prev.messages.filter((m) => m.sender !== 'queue');
          const queueMessages: ChatMessage[] = queue.map((q) => ({
            id: q.id,
            sender: 'queue' as const,
            text: q.text,
            images: q.images,
            ts: q.ts,
          }));
          return {
            ...prev,
            messages: [...nonQueueMessages, ...queueMessages],
          };
        });
        break;
      }

      case 'compaction_end':
        setActiveTask((prev) => (prev ? { ...prev, ...msg.payload } : null));
        break;

      case 'agent_start':
        setIsAgentRunning(true);
        setActiveTask((prev) => {
          if (!prev) return null;
          const next = msg.payload?.path ? { ...prev, path: msg.payload.path } : prev;
          return msg.payload?.stats ? { ...next, ...msg.payload.stats } : next;
        });
        break;

      case 'message_start': {
        const { timestamp } = msg.payload;
        setIsAgentRunning(true);
        setActiveTask((prev) => {
          if (!prev) return null;
          const newMsg: ChatMessage = {
            id: `assistant-${timestamp || Date.now()}`,
            sender: 'assistant',
            text: '',
            ts: timestamp || Date.now(),
            toolStatus: 'running',
          };

          return { ...prev, messages: [...settlePendingApiRequests(prev.messages), newMsg] };
        });
        break;
      }

      case 'api_request_start': {
        const { id, timestamp } = msg.payload;
        setIsAgentRunning(true);
        setActiveTask((prev) => {
          if (!prev) return null;
          if (prev.messages.some((m) => m.id === id)) return prev;

          const apiMsg: ChatMessage = {
            id,
            sender: 'api_request',
            text: 'API Request',
            ts: timestamp || Date.now(),
            toolStatus: 'running',
          };

          return { ...prev, messages: [...settlePendingApiRequests(prev.messages), apiMsg] };
        });
        break;
      }

      case 'api_request_end': {
        const { id, cost, error, stats } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;

          const target = prev.messages.find((m) => m.id === id && m.sender === 'api_request');
          let messages = target
            ? prev.messages.map((m) =>
                m === target
                  ? {
                      ...m,
                      toolStatus: error ? ('denied' as const) : ('completed' as const),
                      cost: cost ?? m.cost,
                      errorMessage: error ?? m.errorMessage,
                    }
                  : m,
              )
            : settlePendingApiRequests(prev.messages, { cost, error });

          if (error) {
            messages = appendErrorMessage(messages, `${id}-error`, error);
          }

          const next = { ...prev, messages };
          return stats ? { ...next, ...stats } : next;
        });
        break;
      }

      case 'message_end': {
        const { cost, stats } = msg.payload;

        setActiveTask((prev) => {
          if (!prev) return null;
          const messages = [...settlePendingApiRequests(prev.messages, { cost })];
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender === 'assistant') {
              messages[i] = {
                ...messages[i],
                toolStatus: 'completed' as const,
                cost: cost !== undefined ? cost : messages[i].cost,
              };
              break;
            }
          }
          const next = { ...prev, messages };
          return stats ? { ...next, ...stats } : next;
        });
        break;
      }

      case 'stream_delta': {
        const { text, thinking } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;
          let messages = [...prev.messages];
          let settled = false;
          for (const m of messages) {
            if (m.sender === 'api_request' && m.toolStatus === 'running') {
              settled = true;
              break;
            }
          }
          if (settled) {
            messages = settlePendingApiRequests(messages);
          }
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender === 'assistant') {
              const message = messages[i];
              messages[i] = {
                ...message,
                text: text ? message.text + text : message.text,
                reasoning: thinking ? (message.reasoning || '') + thinking : message.reasoning,
              };
              break;
            }
          }
          return { ...prev, messages };
        });
        break;
      }

      case 'tool_approval_request': {
        const { id, tool_name, arguments: toolArgs } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;
          const exists = prev.messages.some((m) => m.id === id);
          if (exists) {
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      toolStatus: 'approval',
                      toolName: tool_name,
                      toolArgs,
                      text: tool_name,
                      subagent: msg.payload.subagent,
                    }
                  : m,
              ),
            };
          }
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id,
                sender: 'tool',
                text: tool_name,
                toolName: tool_name,
                toolArgs,
                toolStatus: 'approval',
                subagent: msg.payload.subagent,
                ts: Date.now(),
              },
            ],
          };
        });
        break;
      }

      case 'tool_execution_start': {
        const { id, tool_name, arguments: toolArgs } = msg.payload;
        setIsAgentRunning(true);
        setActiveTask((prev) => {
          if (!prev) return null;
          const exists = prev.messages.some((m) => m.id === id);
          if (exists) {
            return { ...prev, messages: prev.messages.map((m) => (m.id === id ? { ...m, toolStatus: 'running' } : m)) };
          }
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id,
                sender: 'tool',
                text: tool_name || '',
                toolName: tool_name,
                toolArgs: toolArgs || '',
                toolStatus: 'running',
                ts: Date.now(),
              },
            ],
          };
        });
        break;
      }

      case 'tool_execution_update': {
        const { id, result } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map((m) => (m.id === id ? { ...m, diff: result } : m)),
          };
        });
        break;
      }

      case 'tool_execution_end': {
        const { id, result, todos, is_error } = msg.payload;
        setActiveTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === id
                ? {
                    ...m,
                    todos,
                    toolStatus: is_error ? 'denied' : 'completed',
                    diff: is_error ? undefined : result,
                  }
                : m,
            ),
          };
        });
        break;
      }

      case 'agent_error':
        setIsAgentRunning(false);
        setActiveTask((prev) => {
          if (!prev) return null;
          const messages = settlePendingApiRequests(prev.messages, { error: msg.payload.message }).map((m) => {
            if (m.sender === 'assistant' && m.toolStatus === 'running') {
              return { ...m, toolStatus: 'completed' as const };
            }
            return m;
          });
          return {
            ...prev,
            messages: appendErrorMessage(messages, crypto.randomUUID(), msg.payload.message),
          };
        });
        break;

      case 'agent_settled':
        setIsAgentRunning(false);
        setActiveTask((prev) => {
          if (!prev) return null;
          const messages = settlePendingApiRequests(prev.messages).map((m) => {
            if (m.sender === 'assistant' && m.toolStatus === 'running') {
              return { ...m, toolStatus: 'completed' as const };
            }
            return m;
          });
          const next = { ...prev, messages };
          return msg.payload ? { ...next, ...msg.payload } : next;
        });
        break;

      case 'info':
        setActiveTask((prev) => {
          const id = crypto.randomUUID();
          if (!prev) {
            return {
              id: 'task-active',
              title: 'Pi',
              messages: [{ id, sender: 'info', text: msg.payload.text, ts: Date.now() }],
              ...EMPTY_STATS,
            };
          }
          return { ...prev, messages: appendInfoMessage(prev.messages, id, msg.payload.text) };
        });
        break;
    }
  }, []);

  return { activeTask, isAgentRunning, setActiveTask, setIsAgentRunning, pendingQuestion, onMessage };
};
