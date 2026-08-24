import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cnfast';
import { Pi } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';
import { ChatBody } from '@pi-code/webview/components/chat/ChatBody';
import { ChatFooter } from '@pi-code/webview/components/chat/ChatFooter';
import { ChatHeader, ChatSearchBar } from '@pi-code/webview/components/chat/ChatHeader';
import { ChatInput } from '@pi-code/webview/components/chat/ChatInput';
import { getMessageSearchText } from '@pi-code/webview/components/chat/helpers/search';
import { useChatActions } from '@pi-code/webview/components/chat/hooks/useChatActions';
import { useChatConfig } from '@pi-code/webview/components/chat/hooks/useChatConfig';
import { WorkspacePicker } from '@pi-code/webview/components/chat/WorkspacePicker';
import { HistoryPreview } from '@pi-code/webview/components/history/HistoryPreview';
import { HistoryView } from '@pi-code/webview/components/history/HistoryView';
import { useHistoryFilter } from '@pi-code/webview/components/history/hooks/useHistoryFilter';
import { SettingsView } from '@pi-code/webview/components/setting/SettingsView';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { SEARCH_HIT_ACTIVE_CLASS } from '@pi-code/webview/components/shared/Highlight';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { groupToolMessages, hasPendingApproval, isRenderableMessage, latestTodos } from '@pi-code/webview/helpers/messages';
import { useAutoScroll } from '@pi-code/webview/hooks/useAutoScroll';
import { selectPendingQuestion, setComposerTextarea, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';
import type { HistoryItem } from '@pi-code/shared/core/protocol';
import type { ChatMessage } from '@pi-code/shared/core/types';

// Rough per-sender heights for the virtualizer's first estimate; measured row
// sizes replace them once rows mount.
const ESTIMATED_ROW_HEIGHT: Record<ChatMessage['sender'], number> = {
  api_request: 44,
  checkpoint: 44,
  info: 44,
  error: 96,
  user: 96,
  queue: 96,
  tool: 120,
  assistant: 200,
};

export const ChatView: FC = () => {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [showDeleteActiveConfirm, setShowDeleteActiveConfirm] = useState(false);

  const config = useChatConfig();
  const view = useChatStore((state) => state.view);
  const setView = useChatStore((state) => state.setView);
  const inputValue = useChatStore((state) => state.inputValue);
  const setInputValue = useChatStore((state) => state.setInputValue);
  const appendToInput = useChatStore((state) => state.appendToInput);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    setComposerTextarea(textareaRef);
    return () => setComposerTextarea(null);
  }, []);

  const scope = useChatStore((state) => state.scope);
  const pastTasks = useChatStore((state) => state.historyByScope[state.scope]);
  const setScope = useChatStore((state) => state.setScope);
  const deleteSessions = useChatStore((state) => state.deleteSessions);

  // Fetch the active scope's history the first time the history view opens.
  useEffect(() => {
    if (view === 'history') useChatStore.getState().getHistory(scope);
  }, [view, scope]);

  // The history list's filter and selection state live here (not inside
  // HistoryView) so they survive the view switching to a task and back.
  const historyFilter = useHistoryFilter(pastTasks, 6);
  const [isHistorySelectionMode, setIsHistorySelectionMode] = useState(false);
  const [historySelectedPaths, setHistorySelectedPaths] = useState<string[]>([]);

  const activeTask = useChatStore((state) => state.activeTask);
  const isRunning = useChatStore((state) => state.isRunning);
  const isCompacting = useChatStore((state) => state.isCompacting);
  const pendingQuestion = useChatStore(selectPendingQuestion);

  // Remembers whether the open task was launched from the history list so it
  // returns there on close. Kept separate from the settings flag because
  // settings can open on top of a task and must not overwrite this.
  const taskFromHistoryRef = useRef(false);

  useEffect(() => {
    useChatStore.getState().send({ type: 'init' });
  }, []);

  // Focus the composer when a pending question appears.
  const pendingQuestionId = pendingQuestion?.id;
  useEffect(() => {
    if (!pendingQuestionId) return;
    const timer = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pendingQuestionId, textareaRef]);

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
  const { handleSendPrompt, handleToolResponse, handleAnswerQuestion, handleCloseTask, handleCancelTask, handleDeleteActiveTask } = useChatActions();

  const { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom, onWheel, onPointerDown, onPointerUp, onKeyDown } = useAutoScroll(
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
  const { reset: resetHistoryFilter } = historyFilter;

  const handleHistoryDone = useCallback(() => {
    resetHistoryFilter();
    setIsHistorySelectionMode(false);
    setHistorySelectedPaths([]);
    setScope('current');
    setView('chat');
    taskFromHistoryRef.current = false;
  }, [resetHistoryFilter, setIsHistorySelectionMode, setHistorySelectedPaths, setScope, setView]);

  // Closing settings returns to the history list when it was opened from there
  // (state preserved); otherwise it returns to the chat.
  const handleSettingsDone = useCallback(() => {
    if (useChatStore.getState().openedSettingsFromHistory) {
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
        document.querySelector(`.${SEARCH_HIT_ACTIVE_CLASS}`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [activeMatch, globalOffsets, matchCounts, virtualizer]);

  // Acting on a row means the user is engaged with the newest output, so
  // re-engage bottom-follow before the response to that action arrives.
  const handleRespondToTool = useCallback(
    (msgId: string, approved: boolean) => {
      scrollToBottom();
      handleToolResponse(msgId, approved);
    },
    [scrollToBottom, handleToolResponse],
  );

  const handleAnswer = useCallback(
    (questionId: string, text: string, images?: string[]) => {
      scrollToBottom();
      handleAnswerQuestion(questionId, text, images);
    },
    [scrollToBottom, handleAnswerQuestion],
  );

  const loadSession = useCallback(
    (item: HistoryItem) => {
      taskFromHistoryRef.current = view === 'history';
      useChatStore.getState().send({ type: 'load_session', id: item.id, path: item.path, title: item.task });
    },
    [view],
  );

  const exportSession = useCallback((item: { id: string; path?: string }) => {
    if (!item.path) return;
    useChatStore.getState().send({ type: 'export_session', path: item.path, id: item.id });
  }, []);

  const viewRaw = useCallback((path: string | undefined) => {
    if (path) useChatStore.getState().send({ type: 'view_raw_task', path });
  }, []);

  const handleArchive = useCallback((): void => {
    if (!activeTask?.path) return;
    useChatStore.getState().send({ type: 'archive_session', path: activeTask.path, id: activeTask.id, title: activeTask.title });
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
  const activeTaskTodos = activeTask ? latestTodos(activeTask.messages) : undefined;

  return (
    <div className="view-container">
      {/* Task Header / Welcome Header */}
      {activeTask ? (
        searchOpen ? (
          <div className="py-2 px-3.5 border-b border-vscode-editorGroup-border/30 bg-vscode-sideBar-background shrink-0 select-none">
            <ChatSearchBar
              query={searchQuery}
              matchCount={totalMatches}
              activeMatchNumber={totalMatches > 0 ? activeMatch + 1 : 0}
              onChange={setSearchQuery}
              onPrev={() => goToMatch(-1)}
              onNext={() => goToMatch(1)}
              onClose={closeSearch}
            />
          </div>
        ) : (
          <ChatHeader
            title={activeTask.title}
            tokensIn={activeTask.tokensIn}
            tokensOut={activeTask.tokensOut}
            cacheWrites={activeTask.cacheWrites}
            cacheReads={activeTask.cacheReads}
            totalCost={activeTask.totalCost}
            contextTokens={activeTask.contextTokens}
            todos={activeTaskTodos}
            contextLimit={config.selectedModelContextWindow}
            onClose={handleCloseTaskReturn}
            onCompact={() => useChatStore.getState().compact()}
            onExport={activeTask.path ? () => exportSession(activeTask) : undefined}
            onDelete={activeTask.path ? () => setShowDeleteActiveConfirm(true) : undefined}
            onViewRaw={() => viewRaw(activeTask.path)}
            onArchive={handleArchive}
            isArchived={activeTask?.isArchived}
            archiveDisabled={isRunning || !activeTask?.path}
            deleteDisabled={isRunning}
            onSearchOpen={() => setSearchOpen(true)}
          />
        )
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
          <WorkspacePicker />
        </div>
      )}

      {/* Main Viewport */}
      {activeTask ? (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
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
                      ? { query: searchQuery, globalOffset: globalOffsets[item.index] ?? 0, activeIndex: activeMatch }
                      : undefined
                  }
                  onRespondTool={handleRespondToTool}
                  onAnswerQuestion={handleAnswer}
                  onCopyToInput={appendToInput}
                />
              </div>
            ))}
          </div>
          {isCompacting && (
            <div className="px-3.5 py-2.5 flex items-center gap-2 text-xs text-vscode-foreground select-none">
              <Spinner className="text-vscode-focusBorder" />
              <span className="font-semibold">Compacting context...</span>
            </div>
          )}
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
        isRunning={isRunning}
        isCompacting={isCompacting}
        onScrollToBottom={scrollToBottom}
        onCancelTask={handleCancelTask}
        onCloseTask={handleCloseTaskReturn}
        onContinueTask={() => {
          if (!activeTask) return;
          scrollToBottom();
          useChatStore.getState().send({ type: 'continue_task', path: activeTask.path });
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
