import { useEffect, useRef, useState } from 'react';

import { ChatBody } from '@extension/webview/components/chat/ChatBody';
import { ChatFooter } from '@extension/webview/components/chat/ChatFooter';
import { ChatHeader } from '@extension/webview/components/chat/ChatHeader';
import { ChatLogo } from '@extension/webview/components/chat/ChatLogo';
import { ChatTextArea } from '@extension/webview/components/chat/ChatTextArea';
import { HistoryPreview } from '@extension/webview/components/history/HistoryPreview';
import { HistoryView } from '@extension/webview/components/history/HistoryView';
import { SettingsView } from '@extension/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';
import { getMockTask } from '@extension/webview/utilities/mock';
import { vscode } from '@webview/utilities/vscode';

import type { FC } from 'react';
import type { ChatMessage, ExtensionToWebviewMessage, HistoryItem } from '@extension/types/webview';
import type { ActiveTaskState } from '@extension/webview/utilities/mock';

export const ChatView: FC = () => {
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [selectedModel, setSelectedModel] = useState('pi-code');
  const [inputValue, setInputValue] = useState('');
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [showDeleteActiveConfirm, setShowDeleteActiveConfirm] = useState(false);

  // Real backend states
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [pastTasks, setPastTasks] = useState<HistoryItem[]>([]);
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat');
  const [scope, setScope] = useState<'current' | 'all'>('current');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShowScrollToBottom(!isAtBottom);
  };

  const handleScrollToBottom = () => {
    setShowScrollToBottom(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Reset scroll button state when loading or changing tasks
  useEffect(() => {
    setShowScrollToBottom(false);
  }, [activeTask?.id]);

  // Fetch history when view or scope changes
  useEffect(() => {
    if (vscode && view === 'history') {
      vscode.postMessage({ type: 'get_history', scope });
    }
  }, [view, scope]);

  // Auto scroll to bottom of messages
  useEffect(() => {
    if (!showScrollToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTask?.messages]);

  // Request initialization data from VS Code extension backend
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ type: 'init' });
    }
  }, []);

  // Listen for messages from the VS Code extension backend
  useEffect(() => {
    if (!vscode) return;

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;
      switch (msg.type) {
        case 'init_data': {
          const { models: backendModels, history, default_model: defaultModel } = msg.payload;
          setModels(backendModels);
          setPastTasks(history);
          if (defaultModel) {
            setSelectedModel(defaultModel);
          } else if (backendModels.length > 0) {
            setSelectedModel(backendModels[0].id);
          }
          break;
        }

        case 'history_data': {
          const { history } = msg.payload;
          setPastTasks(history);
          break;
        }

        case 'session_loaded': {
          const {
            id,
            title,
            messages,
            path,
            tokensIn = 0,
            tokensOut = 0,
            cacheWrites = 0,
            cacheReads = 0,
            totalCost = 0,
            contextTokens = 0,
            contextLimit = 200000,
          } = msg.payload;
          setActiveTask({
            id,
            title,
            messages,
            path,
            tokensIn,
            tokensOut,
            cacheWrites,
            cacheReads,
            totalCost,
            contextTokens,
            contextLimit,
          });
          setView('chat');
          setIsAgentRunning(false);
          break;
        }

        case 'stats_update': {
          const { tokensIn, tokensOut, cacheWrites, cacheReads, totalCost, contextTokens, contextLimit } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              tokensIn,
              tokensOut,
              cacheWrites: cacheWrites !== undefined ? cacheWrites : prev.cacheWrites,
              cacheReads: cacheReads !== undefined ? cacheReads : prev.cacheReads,
              totalCost,
              contextTokens,
              contextLimit,
            };
          });
          break;
        }

        case 'agent_start': {
          const { path } = msg.payload || {};
          setIsAgentRunning(true);
          if (path) {
            setActiveTask((prev) => {
              if (!prev) return null;
              return { ...prev, path };
            });
          }
          break;
        }

        case 'message_start': {
          const { role, timestamp } = msg.payload;
          setIsAgentRunning(true);
          setActiveTask((prev) => {
            if (!prev) return null;
            const isUser = role === 'user';

            // Avoid duplication of user messages
            if (isUser && prev.messages.some((m) => m.sender === 'user' && m.ts >= (timestamp || Date.now()) - 2000)) {
              return prev;
            }

            // Mark any running api_request as completed when assistant starts responding
            let messages = prev.messages;
            if (role === 'assistant') {
              messages = messages.map((m) => {
                if (m.sender === 'api_request' && m.toolStatus === 'running') {
                  return { ...m, toolStatus: 'completed' as const };
                }
                return m;
              });
            }

            const newMsg: ChatMessage = {
              id: `${role}-${timestamp || Date.now()}`,
              sender: isUser ? 'user' : 'assistant',
              text: '',
              ts: timestamp || Date.now(),
            };

            return {
              ...prev,
              messages: [...messages, newMsg],
            };
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
                  messages[i] = {
                    ...messages[i],
                    cost,
                  };
                  break;
                }
              }
              return { ...prev, messages };
            });
          }
          break;
        }

        case 'api_request_start': {
          const { id, timestamp } = msg.payload;
          setIsAgentRunning(true);
          setActiveTask((prev) => {
            if (!prev) return null;
            const newMsg: ChatMessage = {
              id,
              sender: 'api_request',
              text: 'API Request',
              toolStatus: 'running',
              ts: timestamp,
            };
            return {
              ...prev,
              messages: [...prev.messages, newMsg],
            };
          });
          break;
        }

        case 'api_request_end': {
          const { id, cost, error } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = prev.messages.map((m) => {
              if (m.id === id) {
                return {
                  ...m,
                  toolStatus: error ? ('denied' as const) : ('completed' as const),
                  cost: cost !== undefined ? cost : m.cost,
                };
              }
              return m;
            });
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
                messages[i] = {
                  ...messages[i],
                  text: messages[i].text + delta,
                };
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
                messages[i] = {
                  ...messages[i],
                  reasoning: (messages[i].reasoning || '') + delta,
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
            const newMsg: ChatMessage = {
              id,
              sender: 'tool',
              text: tool_name,
              toolName: tool_name,
              toolArgs,
              toolStatus: 'approval',
              ts: Date.now(),
            };
            return {
              ...prev,
              messages: [...prev.messages, newMsg],
            };
          });
          break;
        }

        case 'tool_execution_start': {
          const { id } = msg.payload;
          setIsAgentRunning(true);
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = prev.messages.map((m) => {
              if (m.id === id) {
                return { ...m, toolStatus: 'running' as const };
              }
              return m;
            });
            return { ...prev, messages };
          });
          break;
        }

        case 'tool_execution_end': {
          const { id, result, is_error } = msg.payload;
          setActiveTask((prev) => {
            if (!prev) return null;
            const messages = prev.messages.map((m) => {
              if (m.id === id) {
                return {
                  ...m,
                  toolStatus: (is_error ? 'denied' : 'completed') as 'denied' | 'completed',
                  diff: is_error ? undefined : result,
                };
              }
              return m;
            });
            return { ...prev, messages };
          });
          break;
        }

        case 'agent_error': {
          const { message } = msg.payload;
          setIsAgentRunning(false);
          setActiveTask((prev) => {
            if (!prev) return null;
            const newMsg: ChatMessage = {
              id: `err-${Date.now()}`,
              sender: 'error',
              text: message,
              errorMessage: message,
              ts: Date.now(),
            };
            return {
              ...prev,
              messages: [...prev.messages, newMsg],
            };
          });
          break;
        }

        case 'agent_settled': {
          setIsAgentRunning(false);
          break;
        }

        case 'show_settings': {
          setView('settings');
          break;
        }

        case 'set_chat_input': {
          const { text } = msg.payload;
          setInputValue((prev) => {
            if (prev) {
              return prev + '\n' + text;
            }
            return text;
          });
          setTimeout(() => {
            textareaRef.current?.focus();
          }, 0);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Load a task from history (offline/mock fallback)
  const handleSelectTaskMock = (taskId: string) => {
    const mockTask = getMockTask(taskId);
    if (mockTask) {
      setActiveTask(mockTask);
    }
  };

  const handleSelectPastTask = (item: HistoryItem) => {
    setIsAgentRunning(false);
    if (!vscode) {
      handleSelectTaskMock(item.id);
      setView('chat');
    } else {
      vscode.postMessage({
        type: 'load_session',
        path: item.path,
        id: item.id,
        title: item.task,
      });
    }
  };

  const handleDeleteTasks = (paths: string[]) => {
    if (!vscode) {
      setPastTasks((prev) => prev.filter((item) => !paths.includes(item.path)));
    } else {
      vscode.postMessage({
        type: 'delete_sessions',
        paths,
        scope,
      });
    }
  };

  const handleDeleteTask = (path: string) => {
    handleDeleteTasks([path]);
  };

  const handleViewRawPath = (path: string) => {
    if (!vscode) {
      alert(`Viewing raw task JSON (Offline Mode): ${path}`);
    } else {
      vscode.postMessage({
        type: 'view_raw_task',
        path,
      });
    }
  };

  const handleExportTaskItem = (item: HistoryItem) => {
    if (!vscode) {
      alert(`Exporting task JSON (Offline Mode): ${item.path}`);
    } else {
      vscode.postMessage({
        type: 'export_session',
        path: item.path,
        id: item.id,
      });
    }
  };

  // Select suggestion idea
  const handleSelectIdea = (idea: string) => {
    if (!vscode) {
      setIsAgentRunning(false);
      setActiveTask({
        id: 'custom-' + Date.now(),
        title: idea,
        tokensIn: 1200,
        tokensOut: 200,
        totalCost: 0.015,
        contextTokens: 1400,
        contextLimit: 200000,
        messages: [
          {
            id: 'c1',
            sender: 'user',
            text: idea,
            ts: Date.now(),
          },
          {
            id: 'c2',
            sender: 'assistant',
            ts: Date.now() + 2000,
            reasoning: 'Generating files to fulfill the user task description.',
            text: "I'll create the layout structure for this task.",
            cost: 0.015,
          },
          {
            id: 'c3',
            sender: 'tool',
            ts: Date.now() + 4000,
            text: 'write_to_file',
            toolName: 'write_to_file',
            toolArgs: 'path: index.html',
            diff: `+ <!-- Initial structure for: -->\n+ <!-- ${idea} -->`,
            toolStatus: 'approval',
          },
        ],
      });
    } else {
      setActiveTask({
        id: 'task-active',
        title: idea,
        messages: [
          {
            id: 'u-' + Date.now(),
            sender: 'user',
            text: idea,
            ts: Date.now(),
          },
        ],
        tokensIn: 0,
        tokensOut: 0,
        cacheWrites: 0,
        cacheReads: 0,
        totalCost: 0,
        contextTokens: 0,
        contextLimit: 200000,
      });
      setIsAgentRunning(true);
      vscode.postMessage({ type: 'start_new_task', text: idea, model_id: selectedModel });
    }
  };

  // Handle send prompt in chat area
  const handleSendPrompt = (text: string, _images: string[]) => {
    setShowScrollToBottom(false);
    if (!vscode) {
      if (activeTask) {
        setIsAgentRunning(true);
        const updatedMessages = [
          ...activeTask.messages,
          {
            id: 'u-' + Date.now(),
            sender: 'user' as const,
            text,
            ts: Date.now(),
          },
        ];
        setActiveTask({
          ...activeTask,
          messages: updatedMessages,
        });

        setTimeout(() => {
          setActiveTask((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              tokensIn: prev.tokensIn + 1500,
              tokensOut: prev.tokensOut + 450,
              cacheWrites: (prev.cacheWrites || 0) + 1,
              cacheReads: (prev.cacheReads || 0) + 2,
              totalCost: prev.totalCost + 0.0245,
              contextTokens: prev.contextTokens + 1950,
              messages: [
                ...prev.messages,
                {
                  id: 'a-' + Date.now(),
                  sender: 'assistant',
                  ts: Date.now(),
                  reasoning: 'Simulating assistance to custom feedback.',
                  text: 'Here is the response for your query. Let me know if you would like me to generate any code or run specific commands.',
                  cost: 0.0245,
                },
              ],
            };
          });
          setIsAgentRunning(false);
        }, 1500);
      } else {
        handleSelectIdea(text);
      }
    } else {
      if (!activeTask) {
        setIsAgentRunning(true);
        setActiveTask({
          id: 'task-active',
          title: text,
          messages: [
            {
              id: 'u-' + Date.now(),
              sender: 'user',
              text,
              ts: Date.now(),
            },
          ],
          tokensIn: 0,
          tokensOut: 0,
          cacheWrites: 0,
          cacheReads: 0,
          totalCost: 0,
          contextTokens: 0,
          contextLimit: 200000,
        });
        vscode.postMessage({ type: 'start_new_task', text, model_id: selectedModel });
      } else {
        setIsAgentRunning(true);
        setActiveTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: 'u-' + Date.now(),
                sender: 'user',
                text,
                ts: Date.now(),
              },
            ],
          };
        });
        vscode.postMessage({ type: 'send_message', text });
      }
    }
  };

  // Handle tool approval
  const handleApproveTool = (msgId: string) => {
    setShowScrollToBottom(false);
    setIsAgentRunning(true);
    if (!vscode) {
      const updatedMessages = activeTask?.messages.map((m) => {
        if (m.id === msgId) {
          return { ...m, toolStatus: 'running' as const };
        }
        return m;
      });

      if (activeTask && updatedMessages) {
        setActiveTask({
          ...activeTask,
          messages: updatedMessages,
        });
      }

      setTimeout(() => {
        setActiveTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map((m) => {
              if (m.id === msgId) {
                return { ...m, toolStatus: 'completed' as const };
              }
              return m;
            }),
          };
        });
        setIsAgentRunning(false);
      }, 1500);
    } else {
      setActiveTask((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          messages: prev.messages.map((m) => {
            if (m.id === msgId) {
              return { ...m, toolStatus: 'running' as const };
            }
            return m;
          }),
        };
      });
      vscode.postMessage({ type: 'approve_tool', approval_id: msgId });
    }
  };

  // Handle tool denial
  const handleDenyTool = (msgId: string) => {
    setShowScrollToBottom(false);
    setIsAgentRunning(true);
    if (!vscode) {
      const updatedMessages = activeTask?.messages.map((m) => {
        if (m.id === msgId) {
          return { ...m, toolStatus: 'denied' as const };
        }
        return m;
      });

      if (activeTask && updatedMessages) {
        setActiveTask({
          ...activeTask,
          messages: updatedMessages,
        });
      }
      setIsAgentRunning(false);
    } else {
      setActiveTask((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          messages: prev.messages.map((m) => {
            if (m.id === msgId) {
              return { ...m, toolStatus: 'denied' as const };
            }
            return m;
          }),
        };
      });
      vscode.postMessage({ type: 'deny_tool', approval_id: msgId });
    }
  };

  // Handle restore checkpoint
  const handleRestoreCheckpoint = (hash: string) => {
    alert(`Restoring repository state to checkpoint ${hash}`);
  };

  // Handle export task messages to JSON
  const handleExportTask = () => {
    if (!activeTask) return;
    const jsonString = JSON.stringify(activeTask.messages, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pi-code-task-${activeTask.id || Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Handle delete active task
  const handleDeleteActiveTask = () => {
    if (!activeTask) return;
    const currentTaskItem = pastTasks.find((item) => item.id === activeTask.id);
    if (currentTaskItem) {
      vscode?.postMessage({
        type: 'delete_sessions',
        paths: [currentTaskItem.path],
        scope,
      });
    }
    handleCloseTask();
  };

  // Handle view raw task in VS Code
  const handleViewRaw = () => {
    if (!activeTask) return;
    if (!vscode) {
      alert(`Viewing raw task JSON (Offline Mode): ${activeTask.path || 'no path'}`);
    } else {
      vscode.postMessage({
        type: 'view_raw_task',
        path: activeTask.path,
      });
    }
  };

  const handleCloseTask = () => {
    if (vscode) {
      vscode.postMessage({ type: 'close_task' });
    }
    setActiveTask(null);
    setIsAgentRunning(false);
  };

  const handleCancelTask = () => {
    if (vscode) {
      vscode.postMessage({ type: 'cancel_task' });
    } else {
      setIsAgentRunning(false);
    }
  };

  if (view === 'settings') {
    return (
      <div className="fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
        <SettingsView onDone={() => setView('chat')} />
      </div>
    );
  }

  if (view === 'history') {
    return (
      <div className="fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
        <HistoryView
          history={pastTasks}
          onSelectTask={handleSelectPastTask}
          onDone={() => setView('chat')}
          onDeleteTasks={handleDeleteTasks}
          scope={scope}
          setScope={setScope}
          onViewRaw={handleViewRawPath}
          onExport={handleExportTaskItem}
        />
      </div>
    );
  }

  const todos = activeTask
    ? (() => {
        const messages = activeTask.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.toolName === 'update_todo' && msg.diff) {
            const lines = msg.diff.split('\n');
            const list: { content: string; status: 'pending' | 'completed' | 'in_progress' }[] = [];
            for (const line of lines) {
              const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s*(.+)$/);
              if (match) {
                const indicator = match[1].toLowerCase();
                const status = indicator === 'x' ? 'completed' : indicator === '-' || indicator === '~' ? 'in_progress' : 'pending';
                list.push({ content: match[2], status });
              }
            }
            return list;
          }
        }
        return undefined;
      })()
    : undefined;

  const showActionButtons = !!(
    activeTask &&
    (showScrollToBottom || isAgentRunning || (!isAgentRunning && !activeTask.messages.some((msg) => msg.toolStatus === 'approval')))
  );

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
      {/* Task Header or Welcome Header */}
      {activeTask ? (
        <ChatHeader
          title={activeTask.title}
          tokensIn={activeTask.tokensIn}
          tokensOut={activeTask.tokensOut}
          cacheWrites={activeTask.cacheWrites}
          cacheReads={activeTask.cacheReads}
          totalCost={activeTask.totalCost}
          contextTokens={activeTask.contextTokens}
          contextLimit={activeTask.contextLimit}
          onClose={handleCloseTask}
          onCondense={() => alert('Condensing conversation context...')}
          onExport={handleExportTask}
          onDelete={pastTasks.some((item) => item.id === activeTask.id) ? () => setShowDeleteActiveConfirm(true) : undefined}
          onViewRaw={handleViewRaw}
          todos={todos}
        />
      ) : (
        <div className="flex items-center justify-between w-full mx-auto px-5 pt-3 shrink-0 select-none">
          <div className="flex text-[var(--vscode-descriptionForeground)]">
            <button
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="flex items-center cursor-pointer bg-transparent border-none text-xs font-semibold text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
            >
              <span className={`codicon ${historyExpanded ? 'codicon-eye' : 'codicon-eye-closed'} scale-90 mr-1.5`} />
              <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">Recent Tasks</span>
            </button>
          </div>
        </div>
      )}

      {/* Main content viewport */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {activeTask ? (
          <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 flex flex-col overflow-y-auto p-1.5">
            {activeTask.messages.map((msg, idx) => (
              <div id={`msg-${msg.id}`} key={msg.id}>
                <ChatBody
                  message={msg}
                  isLast={idx === activeTask.messages.length - 1}
                  onApproveTool={handleApproveTool}
                  onDenyTool={handleDenyTool}
                  onRestoreCheckpoint={handleRestoreCheckpoint}
                />
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="w-full flex-grow flex flex-col justify-start gap-4 px-3.5 transition-all duration-300">
            <div className="flex flex-col justify-center flex-grow py-4">
              <ChatLogo />
              <p className="text-[var(--vscode-editor-foreground)] leading-relaxed font-sans text-center text-balance max-w-[380px] mx-auto my-3 text-sm">
                Generate, refactor, and debug code with Pi Code.
              </p>
              {historyExpanded && (
                <HistoryPreview
                  history={pastTasks}
                  onSelectTask={handleSelectPastTask}
                  onViewAllHistory={() => setView('history')}
                  onDeleteTask={handleDeleteTask}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {showActionButtons && (
        <div className="flex gap-2 px-3.5 pt-2 pb-2 shrink-0">
          {showScrollToBottom ? (
            <button
              onClick={handleScrollToBottom}
              title="Scroll to bottom of chat"
              className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span className="codicon codicon-chevron-down mr-1" />
            </button>
          ) : isAgentRunning ? (
            <button
              onClick={handleCancelTask}
              className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1" />
              Cancel Task
            </button>
          ) : activeTask.messages.some((msg) => msg.toolName === 'attempt_completion') ? (
            <button
              onClick={handleCloseTask}
              className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
            >
              Start New Task
            </button>
          ) : (
            <>
              <button
                onClick={() => handleSendPrompt('Continue', [])}
                className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
              >
                Continue
              </button>
              <button
                onClick={handleCloseTask}
                className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border cursor-pointer flex items-center justify-center gap-1.5"
              >
                New Task
              </button>
            </>
          )}
        </div>
      )}

      {/* Chat Input Text Area */}
      <ChatTextArea
        textareaRef={textareaRef}
        inputValue={inputValue}
        setInputValue={setInputValue}
        onSend={handleSendPrompt}
        sendingDisabled={isAgentRunning || (activeTask?.messages.some((msg) => msg.toolStatus === 'approval') ?? false)}
        placeholderText={activeTask ? 'Reply to Pi Code...' : 'Ask a question or type a command...'}
        className={showActionButtons ? '' : 'pt-2'}
      />

      {/* Bottom controls */}
      <ChatFooter currentModel={selectedModel} onChangeModel={setSelectedModel} models={models} />

      <ConfirmDialog
        isOpen={showDeleteActiveConfirm}
        title="Delete Task"
        description="Are you sure you want to delete this task?"
        onConfirm={() => {
          handleDeleteActiveTask();
          setShowDeleteActiveConfirm(false);
        }}
        onCancel={() => setShowDeleteActiveConfirm(false)}
      />
    </div>
  );
};
