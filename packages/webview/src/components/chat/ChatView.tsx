import { cn } from 'cnfast';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';
import { ChatBody } from '@pi-code/webview/components/chat/ChatBody';
import { ChatFooter } from '@pi-code/webview/components/chat/ChatFooter';
import { ChatHeader } from '@pi-code/webview/components/chat/ChatHeader';
import { ChatInput } from '@pi-code/webview/components/chat/ChatInput';
import { isRenderableMessage } from '@pi-code/webview/components/chat/helpers/message';
import { useActiveTask } from '@pi-code/webview/components/chat/hooks/useActiveTask';
import { useChatActions } from '@pi-code/webview/components/chat/hooks/useChatActions';
import { useChatComposer } from '@pi-code/webview/components/chat/hooks/useChatComposer';
import { useChatConfig } from '@pi-code/webview/components/chat/hooks/useChatConfig';
import { useChatHistory } from '@pi-code/webview/components/chat/hooks/useChatHistory';
import { HistoryPreview } from '@pi-code/webview/components/history/HistoryPreview';
import { HistoryView } from '@pi-code/webview/components/history/HistoryView';
import { SettingsView } from '@pi-code/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { useAutoScroll } from '@pi-code/webview/hooks/useAutoScroll';
import { exportTaskAsJson } from '@pi-code/webview/utilities/common';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem } from '@pi-code/shared/core/protocol';

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

  const composer = useChatComposer();
  const config = useChatConfig();
  const history = useChatHistory({ view: composer.view, scope: composer.scope });
  const task = useActiveTask();

  // Fan every incoming extension message out to the domain hook that owns its
  // state. Each hook's onMessage ignores the message types it does not handle.
  useEffect(() => {
    if (!vscode) return;

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      const msg = event.data;
      composer.onMessage(msg);
      config.onMessage(msg);
      history.onMessage(msg);
      task.onMessage(msg);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [composer.onMessage, config.onMessage, history.onMessage, task.onMessage]);

  useEffect(() => {
    vscode?.postMessage({ type: 'init' });
  }, []);

  // Focus the composer when a pending question appears.
  const pendingQuestionId = task.pendingQuestion?.id;
  useEffect(() => {
    if (!pendingQuestionId) return;
    const timer = setTimeout(() => composer.textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pendingQuestionId, composer.textareaRef]);

  const { activeTask, isAgentRunning, pendingQuestion } = task;
  const { models, settings, selectedModel, setSelectedModel, commands } = config;
  const { pastTasks, setPastTasks } = history;
  const { view, setView, scope, setScope, inputValue, setInputValue, textareaRef } = composer;

  const { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCopyToInput, handleCloseTask, handleDeleteActiveTask } = useChatActions({
    activeTask: task.activeTask,
    models: config.models,
    selectedModel: config.selectedModel,
    pendingQuestion: task.pendingQuestion,
    setActiveTask: task.setActiveTask,
    setIsAgentRunning: task.setIsAgentRunning,
    setPastTasks: history.setPastTasks,
    setInputValue: composer.setInputValue,
    textareaRef: composer.textareaRef,
  });

  const { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom } = useAutoScroll(activeTask?.id);

  const messages = activeTask?.messages;
  const visibleMessages = useMemo(() => (messages ?? []).filter(isRenderableMessage), [messages]);

  // Acting on a row means the user is engaged with the newest output, so
  // re-engage bottom-follow before the response to that action arrives.
  const handleApproveTool = useCallback(
    (msgId: string) => {
      scrollToBottom();
      handleToolResponse(msgId, 'running', 'approve_tool');
    },
    [scrollToBottom, handleToolResponse],
  );

  const handleDenyTool = useCallback(
    (msgId: string) => {
      scrollToBottom();
      handleToolResponse(msgId, 'denied', 'deny_tool');
    },
    [scrollToBottom, handleToolResponse],
  );

  const handleAnswer = useCallback(
    (questionId: string, text: string) => {
      scrollToBottom();
      handleAnswerQuestion(questionId, text);
    },
    [scrollToBottom, handleAnswerQuestion],
  );

  if (view === 'settings') {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
        {settings ? (
          <SettingsView settings={settings} onDone={() => setView('chat')} />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--vscode-descriptionForeground)] text-xs select-none">
            Loading settings...
          </div>
        )}
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
            vscode?.postMessage({ type: 'delete_sessions', paths });
          }}
          scope={scope}
          setScope={setScope}
          onViewRaw={(path) => vscode?.postMessage({ type: 'view_raw_task', path })}
          onExport={(item) => vscode?.postMessage({ type: 'export_session', path: item.path, id: item.id })}
        />
      </div>
    );
  }

  // A pending question keeps the composer usable so the user can answer with
  // free text instead of picking one of the suggestions.
  const isAwaitingApproval = activeTask?.messages.some((m) => m.toolStatus === 'approval') ?? false;
  const isInputDisabled = !pendingQuestion && (isAgentRunning || isAwaitingApproval);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden max-w-5xl mx-auto bg-[var(--vscode-sideBar-background)]">
      {/* Task Header / Welcome Header */}
      {activeTask ? (
        <ChatHeader
          {...activeTask}
          onClose={handleCloseTask}
          onCompact={() => {
            if (!activeTask) return;
            vscode?.postMessage({ type: 'compact', id: activeTask.id, path: activeTask.path, title: activeTask.title });
          }}
          onExport={() => exportTaskAsJson(activeTask)}
          onDelete={!isAgentRunning && activeTask.path ? () => setShowDeleteActiveConfirm(true) : undefined}
          onViewRaw={() => vscode?.postMessage({ type: 'view_raw_task', path: activeTask.path })}
        />
      ) : (
        <div className="flex items-center justify-between w-full mx-auto px-3.5 pt-3 shrink-0 select-none">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="flex items-center cursor-pointer bg-transparent border-none text-xs font-semibold text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
          >
            <span className={cn('codicon', historyExpanded ? 'codicon-eye' : 'codicon-eye-closed', 'scale-90 mr-1.5')} />
            <span className="text-xs">Recent Tasks</span>
          </button>
        </div>
      )}

      {/* Main Viewport */}
      {activeTask ? (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
          <div ref={contentRef} className="flex flex-col p-1.5">
            {visibleMessages.map((msg) => (
              <ChatBody
                key={msg.id}
                message={msg}
                commands={commands}
                onApproveTool={handleApproveTool}
                onDenyTool={handleDenyTool}
                onAnswerQuestion={handleAnswer}
                onCopyToInput={handleCopyToInput}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
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
                    vscode?.postMessage({ type: 'delete_sessions', paths: [path] });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

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
          scrollToBottom();
          vscode?.postMessage({
            type: 'continue_task',
            path: activeTask.path,
            model_id: selectedModel,
            model_provider: models.find((m) => m.id === selectedModel)?.provider,
          });
        }}
      />

      {/* Input Area */}
      <ChatInput
        textareaRef={textareaRef}
        inputValue={inputValue}
        setInputValue={setInputValue}
        commands={commands}
        onSend={(text, images) => {
          scrollToBottom();
          handleSendPrompt(text, images);
        }}
        sendingDisabled={isInputDisabled}
        placeholderText={pendingQuestion ? 'Type your answer...' : activeTask ? 'Reply to Pi Code...' : 'Ask a question or type a command...'}
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
