import { cn } from 'cnfast';
import { useState } from 'react';

import { ChatAction } from '@extension/webview/components/chat/ChatAction';
import { ChatBody } from '@extension/webview/components/chat/ChatBody';
import { ChatFooter } from '@extension/webview/components/chat/ChatFooter';
import { ChatHeader } from '@extension/webview/components/chat/ChatHeader';
import { ChatInput } from '@extension/webview/components/chat/ChatInput';
import { exportTaskAsJson } from '@extension/webview/components/chat/helpers/common';
import { useChatSession } from '@extension/webview/components/chat/hooks/useChatSession';
import { HistoryPreview } from '@extension/webview/components/history/HistoryPreview';
import { HistoryView } from '@extension/webview/components/history/HistoryView';
import { SettingsView } from '@extension/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';
import { useAutoScroll } from '@extension/webview/hooks/useAutoScroll';
import { vscode } from '@webview/utilities/vscode';

import type { FC } from 'react';
import type { HistoryItem } from '@extension/types/webview';

export const ChatLogo: FC = () => {
  return (
    <div className="flex items-center justify-center w-14 h-14 mx-auto my-2" data-testid="pi-code-logo">
      <svg
        className="w-full h-full text-[var(--vscode-focusBorder,rgba(0,122,204,0.85))] dark:text-[var(--vscode-focusBorder,rgba(0,122,204,0.85))]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="2" width="20" height="20" rx="4" />
        <path d="m16 8-4 4 4 4" />
        <path d="M12 8v8" />
        <path d="m8 8 4 4-4 4" />
      </svg>
    </div>
  );
};

export const ChatView: FC = () => {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [showDeleteActiveConfirm, setShowDeleteActiveConfirm] = useState(false);

  const {
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
  } = useChatSession();

  const { messagesEndRef, scrollContainerRef, showScrollToBottom, setShowScrollToBottom, handleScroll, scrollToBottom } = useAutoScroll(
    activeTask?.messages ?? [],
    activeTask?.id,
  );

  if (view === 'settings') {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
        <SettingsView onDone={() => setView('chat')} />
      </div>
    );
  }

  if (view === 'history') {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
        <HistoryView
          history={pastTasks}
          onSelectTask={(item: HistoryItem) => vscode?.postMessage({ type: 'load_session', path: item.path, id: item.id, title: item.task })}
          onDone={() => setView('chat')}
          onDeleteTasks={(paths) => {
            setPastTasks((prev) => prev.filter((item) => !paths.includes(item.path)));
            vscode?.postMessage({ type: 'delete_sessions', paths, scope });
          }}
          scope={scope}
          setScope={setScope}
          onViewRaw={(path) => vscode?.postMessage({ type: 'view_raw_task', path })}
          onExport={(item) => vscode?.postMessage({ type: 'export_session', path: item.path, id: item.id })}
        />
      </div>
    );
  }

  const isInputDisabled = isAgentRunning || (activeTask?.messages.some((m) => m.toolStatus === 'approval') ?? false);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
      {/* Task Header / Welcome Header */}
      {activeTask ? (
        <ChatHeader
          {...activeTask}
          onClose={handleCloseTask}
          onCondense={() => alert('Condensing conversation context...')}
          onExport={() => exportTaskAsJson(activeTask)}
          onDelete={!isAgentRunning && activeTask.path ? () => setShowDeleteActiveConfirm(true) : undefined}
          onViewRaw={() => vscode?.postMessage({ type: 'view_raw_task', path: activeTask.path })}
        />
      ) : (
        <div className="flex items-center justify-between w-full mx-auto px-5 pt-3 shrink-0 select-none">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="flex items-center cursor-pointer bg-transparent border-none text-xs font-semibold text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
          >
            <span className={cn('codicon', historyExpanded ? 'codicon-eye' : 'codicon-eye-closed', 'scale-90 mr-1.5')} />
            <span className="text-[10px]">Recent Tasks</span>
          </button>
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {activeTask ? (
          <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 flex flex-col overflow-y-auto p-1.5">
            {activeTask.messages
              .filter((msg) => msg.toolName !== 'update_todo')
              .map((msg, idx, filteredArr) => (
                <div id={`msg-${msg.id}`} key={msg.id}>
                  <ChatBody
                    message={msg}
                    isLast={idx === filteredArr.length - 1}
                    onApproveTool={(msgId) => {
                      setShowScrollToBottom(false);
                      handleToolResponse(msgId, 'running', 'approve_tool');
                    }}
                    onDenyTool={(msgId) => {
                      setShowScrollToBottom(false);
                      handleToolResponse(msgId, 'denied', 'deny_tool');
                    }}
                    onRestoreCheckpoint={(hash) => alert(`Restoring repository state to checkpoint ${hash}`)}
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
                  onSelectTask={(item) => vscode?.postMessage({ type: 'load_session', path: item.path, id: item.id, title: item.task })}
                  onViewAllHistory={() => setView('history')}
                  onDeleteTask={(path) => {
                    setPastTasks((prev) => prev.filter((i) => i.path !== path));
                    vscode?.postMessage({ type: 'delete_sessions', paths: [path], scope });
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <ChatAction
        showScrollToBottom={showScrollToBottom}
        isAgentRunning={isAgentRunning}
        activeTask={activeTask}
        onScrollToBottom={scrollToBottom}
        onCancelTask={() => vscode?.postMessage({ type: 'cancel_task' })}
        onCloseTask={handleCloseTask}
        onContinueTask={() => {
          if (!activeTask) return;
          setShowScrollToBottom(false);
          vscode?.postMessage({ type: 'continue_task', path: activeTask.path });
        }}
      />

      {/* Input Area */}
      <ChatInput
        textareaRef={textareaRef}
        inputValue={inputValue}
        setInputValue={setInputValue}
        onSend={(text, images) => {
          setShowScrollToBottom(false);
          handleSendPrompt(text, images);
        }}
        sendingDisabled={isInputDisabled}
        placeholderText={activeTask ? 'Reply to Pi Code...' : 'Ask a question or type a command...'}
      />

      {/* Footer */}
      <ChatFooter currentModel={selectedModel} onChangeModel={setSelectedModel} models={models} />

      {/* Delete Modal */}
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
