import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cnfast';
import { Pi } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';
import { ChatBody } from '@pi-code/webview/components/chat/ChatBody';
import { ChatFooter } from '@pi-code/webview/components/chat/ChatFooter';
import { ChatHeader } from '@pi-code/webview/components/chat/ChatHeader';
import { ChatInput } from '@pi-code/webview/components/chat/ChatInput';
import { ESTIMATED_ROW_HEIGHT, isRenderableMessage } from '@pi-code/webview/components/chat/helpers/message';
import { useActiveTask } from '@pi-code/webview/components/chat/hooks/useActiveTask';
import { useChatActions } from '@pi-code/webview/components/chat/hooks/useChatActions';
import { useChatComposer } from '@pi-code/webview/components/chat/hooks/useChatComposer';
import { useChatConfig } from '@pi-code/webview/components/chat/hooks/useChatConfig';
import { useChatHistory } from '@pi-code/webview/components/chat/hooks/useChatHistory';
import { HistoryPreview } from '@pi-code/webview/components/history/HistoryPreview';
import { HistoryView } from '@pi-code/webview/components/history/HistoryView';
import { SettingsView } from '@pi-code/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useAutoScroll } from '@pi-code/webview/hooks/useAutoScroll';
import { postCompactMessage, vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem } from '@pi-code/shared/core/protocol';

export const ChatView: FC = () => {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [showDeleteActiveConfirm, setShowDeleteActiveConfirm] = useState(false);

  const composer = useChatComposer();
  const config = useChatConfig();
  const history = useChatHistory({ view: composer.view });
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
  const {
    models,
    settings,
    selectedModel,
    modelSelection,
    setSelectedModel,
    thinkingLevels,
    selectedThinkingLevel,
    setSelectedThinkingLevel,
    commands,
  } = config;
  const { pastTasks, deleteSessions, scope, setScope } = history;
  const { view, setView, inputValue, setInputValue, textareaRef } = composer;

  const { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleDeleteActiveTask } = useChatActions({
    activeTask,
    modelSelection,
    pendingQuestion,
    isAgentRunning,
    setActiveTask: task.setActiveTask,
    setIsAgentRunning: task.setIsAgentRunning,
    deleteSessions,
  });

  const { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom } = useAutoScroll(activeTask?.id);

  const messages = activeTask?.messages;
  const visibleMessages = useMemo(() => (messages ?? []).filter(isRenderableMessage), [messages]);

  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ESTIMATED_ROW_HEIGHT[visibleMessages[index].sender],
    getItemKey: (index) => visibleMessages[index].id,
    overscan: 8,
  });

  // Acting on a row means the user is engaged with the newest output, so
  // re-engage bottom-follow before the response to that action arrives.
  const handleApproveTool = useCallback(
    (msgId: string) => {
      scrollToBottom();
      handleToolResponse(msgId, true);
    },
    [scrollToBottom, handleToolResponse],
  );

  const handleDenyTool = useCallback(
    (msgId: string) => {
      scrollToBottom();
      handleToolResponse(msgId, false);
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

  const loadSession = useCallback((item: HistoryItem) => {
    vscode?.postMessage({ type: 'load_session', path: item.path, id: item.id, title: item.task });
  }, []);

  const exportSession = useCallback((item: { id: string; path?: string }) => {
    if (!item.path) return;
    vscode?.postMessage({ type: 'export_session', path: item.path, id: item.id });
  }, []);

  const viewRaw = useCallback((path: string | undefined) => {
    if (path) vscode?.postMessage({ type: 'view_raw_task', path });
  }, []);

  if (view === 'settings') {
    return (
      <div className="view-container">
        {settings ? (
          <SettingsView settings={settings} onDone={() => setView('chat')} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted select-none">Loading settings...</div>
        )}
      </div>
    );
  }

  if (view === 'history') {
    return (
      <div className="view-container">
        <HistoryView
          history={pastTasks}
          onSelectTask={loadSession}
          onDone={() => {
            setScope('current');
            setView('chat');
          }}
          onDeleteTasks={deleteSessions}
          scope={scope}
          setScope={setScope}
          onViewRaw={viewRaw}
          onExport={exportSession}
        />
      </div>
    );
  }

  // A pending question keeps the composer usable so the user can answer with
  // free text instead of picking one of the suggestions.
  const isAwaitingApproval = activeTask?.messages.some((m) => m.toolStatus === 'approval') ?? false;
  const isInputDisabled = !pendingQuestion && isAwaitingApproval;

  return (
    <div className="view-container">
      {/* Task Header / Welcome Header */}
      {activeTask ? (
        <ChatHeader
          {...activeTask}
          onClose={handleCloseTask}
          onCompact={() => postCompactMessage(activeTask)}
          onExport={activeTask.path ? () => exportSession(activeTask) : undefined}
          onDelete={!isAgentRunning && activeTask.path ? () => setShowDeleteActiveConfirm(true) : undefined}
          onViewRaw={() => viewRaw(activeTask.path)}
        />
      ) : (
        <div className="flex items-center justify-between w-full mx-auto px-3.5 pt-3 shrink-0 select-none">
          <Tooltip content={historyExpanded ? 'Hide recent tasks' : 'Show recent tasks'} side="bottom">
            <button
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="text-button text-xs font-semibold text-vscode-descriptionForeground hover:text-vscode-foreground"
            >
              <span className={cn('codicon', historyExpanded ? 'codicon-eye' : 'codicon-eye-closed', 'scale-90')} />
              <span className="text-xs">Recent Tasks</span>
            </button>
          </Tooltip>
        </div>
      )}

      {/* Main Viewport */}
      {activeTask ? (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
          <div ref={contentRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              >
                <ChatBody
                  message={visibleMessages[item.index]}
                  commands={commands}
                  onApproveTool={handleApproveTool}
                  onDenyTool={handleDenyTool}
                  onAnswerQuestion={handleAnswer}
                  onCopyToInput={composer.appendToInput}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div className="w-full flex-grow flex flex-col justify-start gap-4 px-3.5">
            <div className="flex flex-col justify-center flex-grow py-4">
              <div className="flex items-center justify-center w-14 h-14 mx-auto my-2">
                <Pi className="w-full h-full text-vscode-focusBorder" />
              </div>
              <p className="text-vscode-editor-foreground leading-relaxed font-sans text-center text-balance max-w-[380px] mx-auto my-3 text-sm">
                Generate, refactor, and debug code with Pi Code.
              </p>
              {historyExpanded && (
                <HistoryPreview
                  history={pastTasks}
                  onSelectTask={loadSession}
                  onViewAllHistory={() => setView('history')}
                  onDeleteTask={(path) => deleteSessions([path])}
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
            model: modelSelection,
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
      <ChatFooter
        currentModel={selectedModel}
        onChangeModel={setSelectedModel}
        models={models}
        thinkingLevels={thinkingLevels}
        currentThinkingLevel={selectedThinkingLevel}
        onChangeThinkingLevel={setSelectedThinkingLevel}
      />

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
