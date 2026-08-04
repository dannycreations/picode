import { useEffect, useRef, useState } from 'react';

import { vscode } from '@webview/utilities/vscode';

import type { ActiveTaskState, ChatMessage, ExtensionToWebviewMessage, HistoryItem } from '@extension/types/webview';

export function useChatSession() {
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
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

    const handleMessage = (event: MessageEvent) => {
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

            let messages = prev.messages;
            if (role === 'assistant') {
              messages = messages.map((m) =>
                m.sender === 'api_request' && m.toolStatus === 'running' ? { ...m, toolStatus: 'completed' as const } : m,
              );
            }

            const newMsg: ChatMessage = {
              id: `${role}-${timestamp || Date.now()}`,
              sender: isUser ? 'user' : 'assistant',
              text: '',
              ts: timestamp || Date.now(),
            };

            return { ...prev, messages: [...messages, newMsg] };
          });
          break;
        }

        case 'message_end': {
          const { role, cost } = msg.payload || {};
          if (role === 'assistant' && cost !== undefined) {
            setActiveTask((prev) => {
              if (!prev) return null;
              const messages = [...prev.messages];
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].sender === 'assistant') {
                  messages[i] = { ...messages[i], cost };
                  break;
                }
              }
              return { ...prev, messages };
            });
          }
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
                { id, sender: 'tool', text: tool_name, toolName: tool_name, toolArgs, toolStatus: 'approval', ts: Date.now() },
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
                { id, sender: 'tool', text: tool_name || '', toolName: tool_name, toolArgs: toolArgs || '', toolStatus: 'running', ts: Date.now() },
              ],
            };
          });
          break;
        }

        case 'tool_execution_end': {
          const { id, result, is_error } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === id ? { ...m, toolStatus: is_error ? 'denied' : 'completed', diff: is_error ? undefined : result } : m,
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
                  messages: [
                    ...prev.messages,
                    { id: `err-${Date.now()}`, sender: 'error', text: msg.payload.message, errorMessage: msg.payload.message, ts: Date.now() },
                  ],
                }
              : null,
          );
          break;

        case 'agent_settled':
          setIsAgentRunning(false);
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
  const handleSendPrompt = (text: string, images: string[]) => {
    setIsAgentRunning(true);
    const userMsg: ChatMessage = {
      id: 'u-' + Date.now(),
      sender: 'user',
      text,
      images: images.length > 0 ? images : undefined,
      ts: Date.now(),
    };

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
      vscode?.postMessage({ type: 'start_new_task', text, model_id: selectedModel, images });
    } else {
      setActiveTask((prev) => (prev ? { ...prev, messages: [...prev.messages, userMsg] } : null));
      vscode?.postMessage({ type: 'send_message', text, path: activeTask.path, images });
    }
  };

  const handleToolResponse = (msgId: string, status: 'running' | 'denied', actionType: 'approve_tool' | 'deny_tool') => {
    setIsAgentRunning(true);
    setActiveTask((prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === msgId ? { ...m, toolStatus: status } : m)) } : null));
    vscode?.postMessage({ type: actionType, approval_id: msgId });
  };

  const handleCloseTask = () => {
    vscode?.postMessage({ type: 'get_history', scope });
    vscode?.postMessage({ type: 'close_task' });
    setActiveTask(null);
    setIsAgentRunning(false);
  };

  const handleDeleteActiveTask = () => {
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
    inputValue,
    setInputValue,
    view,
    setView,
    scope,
    setScope,
    textareaRef,
    handleSendPrompt,
    handleToolResponse,
    handleCloseTask,
    handleDeleteActiveTask,
  };
}
