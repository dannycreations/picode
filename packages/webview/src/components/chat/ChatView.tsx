import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cnfast';
import { Pi } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';
import { ChatBody } from '@pi-code/webview/components/chat/ChatBody';
import { ChatFooter } from '@pi-code/webview/components/chat/ChatFooter';
import { ChatHeader } from '@pi-code/webview/components/chat/ChatHeader';
import { ChatInput } from '@pi-code/webview/components/chat/ChatInput';
import { ESTIMATED_ROW_HEIGHT, groupToolMessages, hasPendingApproval, isRenderableMessage } from '@pi-code/webview/components/chat/helpers/message';
import { getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';
import { useActiveTask } from '@pi-code/webview/components/chat/hooks/useActiveTask';
import { useChatActions } from '@pi-code/webview/components/chat/hooks/useChatActions';
import { useChatComposer } from '@pi-code/webview/components/chat/hooks/useChatComposer';
import { useChatConfig } from '@pi-code/webview/components/chat/hooks/useChatConfig';
import { useChatHistory } from '@pi-code/webview/components/chat/hooks/useChatHistory';
import { HistoryPreview } from '@pi-code/webview/components/history/HistoryPreview';
import { HistoryView } from '@pi-code/webview/components/history/HistoryView';
import { useHistoryFilter } from '@pi-code/webview/components/history/hooks/useHistoryFilter';
import { SettingsView } from '@pi-code/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useAutoScroll } from '@pi-code/webview/hooks/useAutoScroll';
import { postCompactMessage, vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem } from '@pi-code/shared/core/protocol';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

export const ChatView: FC = () => {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [showDeleteActiveConfirm, setShowDeleteActiveConfirm] = useState(false);

  const composer = useChatComposer();
  const config = useChatConfig();
  const history = useChatHistory({ view: composer.view });
  // The history list's filter and selection state live here (not inside
  // HistoryView) so they survive the view switching to a task and back.
  const historyFilter = useHistoryFilter(history.pastTasks, 6);
  const [isHistorySelectionMode, setIsHistorySelectionMode] = useState(false);
  const [historySelectedPaths, setHistorySelectedPaths] = useState<string[]>([]);
  const task = useActiveTask();

  // Tracks the live view so message-driven navigations (e.g. opening settings)
  // can read the view that was active when the message arrived.
  const viewRef = useRef(composer.view);
  viewRef.current = composer.view;

  // Remembers whether the open task was launched from the history list so it
  // returns there on close. Kept separate from the settings flag because
  // settings can open on top of a task and must not overwrite this.
  const taskFromHistoryRef = useRef(false);

  // Remembers whether settings was opened from the history list, so it returns
  // there on close instead of the chat.
  const settingsFromHistoryRef = useRef(false);

  // Fan every incoming extension message out to the domain hook that owns its
  // state. Each hook's onMessage ignores the message types it does not handle.
  useEffect(() => {
    if (!vscode) return;

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      const msg = event.data;
      if (msg.type === 'show_settings') settingsFromHistoryRef.current = viewRef.current === 'history';
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
    setSelectedModel,
    thinkingLevels,
    selectedThinkingLevel,
    setSelectedThinkingLevel,
    supportsImages,
    commands,
  } = config;
  const { pastTasks, deleteSessions, scope, setScope } = history;
  const { view, setView, inputValue, setInputValue, textareaRef } = composer;

  const { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleCancelTask, handleDeleteActiveTask } = useChatActions({
    activeTask,
    pendingQuestion,
    isAgentRunning,
    setActiveTask: task.setActiveTask,
    setIsAgentRunning: task.setIsAgentRunning,
    deleteSessions,
  });

  const { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom, onWheel, onTouchStart, onPointerDown, onKeyDown } = useAutoScroll(
    activeTask?.id,
  );

  // Closing a task opened from the history list must return to that list (with
  // its scope and cached data intact), not the recent tasks screen.
  const returnToHistoryIfNeeded = useCallback(() => {
    if (taskFromHistoryRef.current) {
      taskFromHistoryRef.current = false;
      setView('history');
    }
  }, [setView]);

  const handleCloseTaskReturn = useCallback(() => {
    handleCloseTask();
    returnToHistoryIfNeeded();
  }, [handleCloseTask, returnToHistoryIfNeeded]);

  // Leaving the history list for the recent tasks screen clears its scope and
  // every in-list state (search, sort, pagination, selection) so it starts
  // fresh next time.
  const { setSearchQuery: resetHistorySearch, setSortBy: resetHistorySort, setCurrentPage: resetHistoryPage } = historyFilter;

  const handleHistoryDone = useCallback(() => {
    resetHistorySearch('');
    resetHistorySort('newest');
    resetHistoryPage(1);
    setIsHistorySelectionMode(false);
    setHistorySelectedPaths([]);
    setScope('current');
    setView('chat');
    taskFromHistoryRef.current = false;
    settingsFromHistoryRef.current = false;
  }, [resetHistorySearch, resetHistorySort, resetHistoryPage, setIsHistorySelectionMode, setHistorySelectedPaths, setScope, setView]);

  // Closing settings returns to the history list when it was opened from there
  // (state preserved); otherwise it returns to the chat.
  const handleSettingsDone = useCallback(() => {
    if (settingsFromHistoryRef.current) {
      settingsFromHistoryRef.current = false;
      setView('history');
    } else {
      setView('chat');
    }
  }, [setView]);

  const messages = activeTask?.messages;
  const visibleMessages = useMemo(() => (messages ?? []).filter(isRenderableMessage), [messages]);
  const renderItems = useMemo(() => groupToolMessages(visibleMessages), [visibleMessages]);

  // In-chat text search: count matches per message so we can show a total, jump
  // between them, and tell each renderer which occurrence to emphasize.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(-1);

  const matchCounts = useMemo(
    () => (searchQuery ? renderItems.map((message) => findOccurrences(getMessageSearchText(message), searchQuery).length) : []),
    [renderItems, searchQuery],
  );
  const totalMatches = matchCounts.reduce((sum, count) => sum + count, 0);
  const globalOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const count of matchCounts) {
      offsets.push(acc);
      acc += count;
    }
    return offsets;
  }, [matchCounts]);

  // A new query always restarts navigation at the first match.
  useEffect(() => {
    setActiveMatch(searchQuery ? (totalMatches > 0 ? 0 : -1) : -1);
    // totalMatches is derived from searchQuery + renderItems; re-running only on
    // the query keeps navigation stable when messages stream in during a search.
  }, [searchQuery]);

  const goToMatch = useCallback(
    (direction: 1 | -1) => {
      setActiveMatch((prev) => {
        if (totalMatches === 0) return -1;
        const base = prev < 0 ? 0 : prev;
        return (base + direction + totalMatches) % totalMatches;
      });
    },
    [totalMatches],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setActiveMatch(-1);
  }, []);

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => ESTIMATED_ROW_HEIGHT[renderItems[index].sender],
    getItemKey: (index) => renderItems[index].id,
    overscan: 8,
  });

  useEffect(() => {
    if (activeMatch < 0) return;
    const itemIndex = globalOffsets.findIndex((offset, index) => activeMatch >= offset && activeMatch < offset + (matchCounts[index] ?? 0));
    if (itemIndex < 0) return;

    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(itemIndex, { align: 'center' });
      innerRaf = requestAnimationFrame(() => {
        document.querySelector('.search-hit-active')?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [activeMatch, globalOffsets, matchCounts, virtualizer]);

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

  const loadSession = useCallback(
    (item: HistoryItem) => {
      taskFromHistoryRef.current = view === 'history';
      vscode?.postMessage({ type: 'load_session', path: item.path, id: item.id, title: item.task });
    },
    [view],
  );

  const exportSession = useCallback((item: { id: string; path?: string }) => {
    if (!item.path) return;
    vscode?.postMessage({ type: 'export_session', path: item.path, id: item.id });
  }, []);

  const viewRaw = useCallback((path: string | undefined) => {
    if (path) vscode?.postMessage({ type: 'view_raw_task', path });
  }, []);

  const handleArchive = useCallback((): void => {
    if (!activeTask?.path) return;
    vscode?.postMessage({ type: 'archive_session', path: activeTask.path, id: activeTask.id, title: activeTask.title });
  }, [activeTask?.path, activeTask?.id, activeTask?.title]);

  if (view === 'settings') {
    return (
      <div className="view-container">
        {settings ? (
          <SettingsView settings={settings} onDone={handleSettingsDone} />
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
          filter={historyFilter}
          onSelectTask={loadSession}
          onDone={handleHistoryDone}
          onDeleteTasks={deleteSessions}
          scope={scope}
          setScope={setScope}
          onViewRaw={viewRaw}
          onExport={exportSession}
          isSelectionMode={isHistorySelectionMode}
          setIsSelectionMode={setIsHistorySelectionMode}
          selectedPaths={historySelectedPaths}
          setSelectedPaths={setHistorySelectedPaths}
        />
      </div>
    );
  }

  // A pending question keeps the composer usable so the user can answer with
  // free text instead of picking one of the suggestions.
  const isAwaitingApproval = activeTask ? hasPendingApproval(activeTask.messages) : false;
  const isInputDisabled = !pendingQuestion && isAwaitingApproval;

  return (
    <div className="view-container">
      {/* Task Header / Welcome Header */}
      {activeTask ? (
        <ChatHeader
          {...activeTask}
          onClose={handleCloseTaskReturn}
          onCompact={() => postCompactMessage(activeTask)}
          onExport={activeTask.path ? () => exportSession(activeTask) : undefined}
          onDelete={activeTask.path ? () => setShowDeleteActiveConfirm(true) : undefined}
          onViewRaw={() => viewRaw(activeTask.path)}
          onArchive={handleArchive}
          isArchived={activeTask?.isArchived}
          archiveDisabled={isAgentRunning || !activeTask?.path}
          deleteDisabled={isAgentRunning}
          isSearchOpen={searchOpen}
          searchQuery={searchQuery}
          matchCount={totalMatches}
          activeMatchNumber={searchOpen && totalMatches > 0 ? activeMatch + 1 : 0}
          onSearchOpen={() => setSearchOpen(true)}
          onSearchClose={closeSearch}
          onSearchChange={setSearchQuery}
          onPrevMatch={() => goToMatch(-1)}
          onNextMatch={() => goToMatch(1)}
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
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          tabIndex={0}
          className="flex-1 min-h-0 overflow-y-auto chat-viewport outline-none"
        >
          <div ref={contentRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              >
                <ChatBody
                  message={renderItems[item.index]}
                  commands={commands}
                  search={
                    searchOpen && searchQuery
                      ? ({ query: searchQuery, globalOffset: globalOffsets[item.index] ?? 0, activeIndex: activeMatch } as SearchContext)
                      : undefined
                  }
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
        activeTask={activeTask}
        showScrollToBottom={showScrollToBottom}
        isAgentRunning={isAgentRunning}
        onScrollToBottom={scrollToBottom}
        onCancelTask={handleCancelTask}
        onCloseTask={handleCloseTaskReturn}
        onContinueTask={() => {
          if (!activeTask) return;
          scrollToBottom();
          vscode?.postMessage({
            type: 'continue_task',
            path: activeTask.path,
          });
        }}
        isAwaitingApproval={isAwaitingApproval}
      />

      {/* Input Area */}
      {!activeTask?.isArchived && (
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
          supportsImages={supportsImages}
          placeholderText={pendingQuestion ? 'Type your answer...' : activeTask ? 'Reply something...' : 'Ask a question or type a command...'}
        />
      )}

      {/* Footer */}
      {!activeTask?.isArchived && (
        <ChatFooter
          currentModel={selectedModel}
          onChangeModel={setSelectedModel}
          models={models}
          thinkingLevels={thinkingLevels}
          currentThinkingLevel={selectedThinkingLevel}
          onChangeThinkingLevel={setSelectedThinkingLevel}
        />
      )}

      {/* Delete Modal */}
      <ConfirmDialog
        isOpen={showDeleteActiveConfirm}
        title="Delete Task"
        description="Are you sure you want to delete this task?"
        onConfirm={() => {
          handleDeleteActiveTask();
          returnToHistoryIfNeeded();
          setShowDeleteActiveConfirm(false);
        }}
        onCancel={() => setShowDeleteActiveConfirm(false)}
      />
    </div>
  );
};
