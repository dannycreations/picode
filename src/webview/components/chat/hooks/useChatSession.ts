import { useEffect, useMemo, useRef, useState } from 'react';

import { findPendingQuestion } from '@extension/webview/components/chat/helpers/question';
import { vscode } from '@webview/utilities/vscode';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ActiveTaskState, ChatMessage, ExtensionToWebviewMessage, HistoryItem, ModelItem } from '@extension/types/webview';

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

export interface UseChatSessionReturn {
  readonly activeTask: ActiveTaskState | null;
  readonly models: ModelItem[];
  readonly selectedModel: string;
  readonly setSelectedModel: Dispatch<SetStateAction<string>>;
  readonly pastTasks: HistoryItem[];
  readonly setPastTasks: Dispatch<SetStateAction<HistoryItem[]>>;
  readonly isAgentRunning: boolean;
  readonly pendingQuestion: ChatMessage | undefined;
  readonly inputValue: string;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly view: 'chat' | 'history' | 'settings';
  readonly setView: Dispatch<SetStateAction<'chat' | 'history' | 'settings'>>;
  readonly scope: 'current' | 'all';
  readonly setScope: Dispatch<SetStateAction<'current' | 'all'>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly handleSendPrompt: (text: string, images: string[]) => void;
  readonly handleToolResponse: (msgId: string, status: 'running' | 'denied', actionType: 'approve_tool' | 'deny_tool') => void;
  readonly handleAnswerQuestion: (questionId: string, text: string) => void;
  readonly handleCopyToInput: (text: string) => void;
  readonly handleCloseTask: () => void;
  readonly handleDeleteActiveTask: () => void;
}

export const useChatSession = (): UseChatSessionReturn => {
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState('pi-code');
  const [pastTasks, setPastTasks] = useState<HistoryItem[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat');
  const [scope, setScope] = useState<'current' | 'all'>('current');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Initial setup & History fetch
  useEffect(() => {
    vscode?.postMessage({ type: 'init' });
  }, []);

  useEffect(() => {
    if (view === 'history') {
      vscode?.postMessage({ type: 'get_history', scope });
    }
  }, [view, scope]);

  // Extension Message Handler
  useEffect(() => {
    if (!vscode) return;

    const handleMessage = (event: MessageEvent): void => {
      const msg = event.data as ExtensionToWebviewMessage;
      switch (msg.type) {
        case 'init_data': {
          const { models: backendModels, history, default_model: defaultModel } = msg.payload;
          setModels(backendModels);
          setPastTasks(history);
          setSelectedModel(defaultModel || backendModels[0]?.id || 'pi-code');
          break;
        }
        case 'history_data':
          setPastTasks(msg.payload.history);
          break;

        case 'session_loaded':
          setActiveTask({
            ...msg.payload,
            tokensIn: msg.payload.tokensIn ?? 0,
            tokensOut: msg.payload.tokensOut ?? 0,
            cacheWrites: msg.payload.cacheWrites ?? 0,
            cacheReads: msg.payload.cacheReads ?? 0,
            totalCost: msg.payload.totalCost ?? 0,
            contextTokens: msg.payload.contextTokens ?? 0,
            contextLimit: msg.payload.contextLimit ?? 200000,
          });
          setView('chat');
          setIsAgentRunning(false);
          break;

        case 'stats_update':
          setActiveTask((prev) => (prev ? { ...prev, ...msg.payload } : null));
          break;

        case 'agent_start':
          setIsAgentRunning(true);
          if (msg.payload?.path) {
            setActiveTask((prev) => (prev ? { ...prev, path: msg.payload.path } : null));
          }
          break;

        case 'message_start': {
          const { role, timestamp } = msg.payload;
          setIsAgentRunning(true);
          setActiveTask((prev) => {
            if (!prev) return null;
            const isUser = role === 'user';

            if (isUser && prev.messages.some((m) => m.sender === 'user' && m.ts >= (timestamp || Date.now()) - 2000)) {
              return prev;
            }

            const newMsg: ChatMessage = {
              id: `${role}-${timestamp || Date.now()}`,
              sender: isUser ? 'user' : 'assistant',
              text: '',
              ts: timestamp || Date.now(),
            };

            return { ...prev, messages: [...prev.messages, newMsg] };
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
          const { id, cost, error } = msg.payload;
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

            return { ...prev, messages };
          });
          break;
        }

        case 'message_end': {
          const { role, cost } = msg.payload || {};
          if (role !== 'assistant') break;

          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = [...settlePendingApiRequests(prev.messages, { cost })];
            if (cost !== undefined) {
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].sender === 'assistant') {
                  messages[i] = { ...messages[i], cost };
                  break;
                }
              }
            }
            return { ...prev, messages };
          });
          break;
        }

        case 'text_delta': {
          const { delta } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = [...prev.messages];
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].sender === 'assistant') {
                messages[i] = { ...messages[i], text: messages[i].text + delta };
                break;
              }
            }
            return { ...prev, messages };
          });
          break;
        }

        case 'thinking_delta': {
          const { delta } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = [...prev.messages];
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].sender === 'assistant') {
                messages[i] = { ...messages[i], reasoning: (messages[i].reasoning || '') + delta };
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
                  m.id === id ? { ...m, toolStatus: 'approval', toolName: tool_name, toolArgs, text: tool_name } : m,
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
          setActiveTask((prev) =>
            prev
              ? {
                  ...prev,
                  messages: appendErrorMessage(
                    settlePendingApiRequests(prev.messages, { error: msg.payload.message }),
                    `err-${Date.now()}`,
                    msg.payload.message,
                  ),
                }
              : null,
          );
          break;

        case 'agent_settled':
          setIsAgentRunning(false);
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = settlePendingApiRequests(prev.messages);
            return messages === prev.messages ? prev : { ...prev, messages };
          });
          break;

        case 'show_settings':
          setView('settings');
          break;

        case 'set_chat_input':
          setInputValue((prev) => (prev ? `${prev}\n${msg.payload.text}` : msg.payload.text));
          setTimeout(() => textareaRef.current?.focus(), 0);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handlers
  const pendingQuestion = useMemo(() => findPendingQuestion(activeTask?.messages ?? []), [activeTask?.messages]);

  const pendingQuestionId = pendingQuestion?.id;
  useEffect(() => {
    if (!pendingQuestionId) return;
    const timer = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pendingQuestionId]);

  const handleAnswerQuestion = (questionId: string, text: string): void => {
    const answer = text.trim();
    if (!answer) return;

    // Settle the card optimistically so the suggestions stop accepting clicks
    // while the tool result travels back from the extension host.
    setActiveTask((prev) =>
      prev ? { ...prev, messages: prev.messages.map((m) => (m.id === questionId ? { ...m, toolStatus: 'completed', diff: answer } : m)) } : null,
    );
    setIsAgentRunning(true);
    vscode?.postMessage({ type: 'question_response', question_id: questionId, text: answer });
  };

  const handleCopyToInput = (text: string): void => {
    setInputValue((prev) => (prev ? `${prev}\n${text}` : text));
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleSendPrompt = (text: string, images: string[]): void => {
    // A pending question owns the input box: the reply answers the tool call
    // instead of starting a new turn.
    if (pendingQuestion) {
      handleAnswerQuestion(pendingQuestion.id, text);
      return;
    }

    setIsAgentRunning(true);
    const userMsg: ChatMessage = {
      id: 'u-' + Date.now(),
      sender: 'user',
      text,
      images: images.length > 0 ? images : undefined,
      ts: Date.now(),
    };

    const selectedProvider = models.find((m) => m.id === selectedModel)?.provider;

    if (!activeTask) {
      setActiveTask({
        id: 'task-active',
        title: text,
        messages: [userMsg],
        tokensIn: 0,
        tokensOut: 0,
        cacheWrites: 0,
        cacheReads: 0,
        totalCost: 0,
        contextTokens: 0,
        contextLimit: 200000,
      });
      vscode?.postMessage({ type: 'start_new_task', text, model_id: selectedModel, model_provider: selectedProvider, images });
    } else {
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
  };

  const handleToolResponse = (msgId: string, status: 'running' | 'denied', actionType: 'approve_tool' | 'deny_tool'): void => {
    setIsAgentRunning(true);
    setActiveTask((prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === msgId ? { ...m, toolStatus: status } : m)) } : null));
    vscode?.postMessage({ type: actionType, approval_id: msgId });
  };

  const handleCloseTask = (): void => {
    vscode?.postMessage({ type: 'get_history', scope });
    vscode?.postMessage({ type: 'close_task' });
    setActiveTask(null);
    setIsAgentRunning(false);
  };

  const handleDeleteActiveTask = (): void => {
    if (!activeTask) return;
    if (activeTask.path) {
      const deletedPath = activeTask.path;
      setPastTasks((prev) => prev.filter((item) => item.path !== deletedPath));
      vscode?.postMessage({ type: 'delete_sessions', paths: [deletedPath], scope });
    }
    vscode?.postMessage({ type: 'close_task' });
    setActiveTask(null);
    setIsAgentRunning(false);
  };

  return {
    activeTask,
    models,
    selectedModel,
    setSelectedModel,
    pastTasks,
    setPastTasks,
    isAgentRunning,
    pendingQuestion,
    inputValue,
    setInputValue,
    view,
    setView,
    scope,
    setScope,
    textareaRef,
    handleSendPrompt,
    handleToolResponse,
    handleAnswerQuestion,
    handleCopyToInput,
    handleCloseTask,
    handleDeleteActiveTask,
  };
};
