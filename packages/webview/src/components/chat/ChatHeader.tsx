import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  Coins,
  FoldVertical,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { TodoView } from '@pi-code/webview/components/chat/TodoView';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { TaskActions } from '@pi-code/webview/components/shared/TaskActions';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC, KeyboardEvent, MouseEvent } from 'react';
import type { StatsData } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

interface ChatHeaderProps extends StatsData {
  readonly title: string;
  readonly todos?: TodoItem[];
  readonly onClose: () => void;
  readonly onCompact: () => void;
  readonly onExport?: () => void;
  readonly onDelete?: () => void;
  readonly onViewRaw?: () => void;
  readonly onArchive?: () => void;
  readonly isArchived?: boolean;
  readonly archiveDisabled?: boolean;
  readonly deleteDisabled?: boolean;
  readonly onSearchOpen: () => void;
}

const ContextProgressBar: FC<{ readonly percentage: number }> = ({ percentage }) => (
  <div className="flex-grow h-1.5 bg-vscode-editor-background rounded-full overflow-hidden border border-vscode-editorGroup-border/40">
    <div className="h-full bg-vscode-charts-blue rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
  </div>
);

export const ChatSearchBar: FC<{
  readonly query: string;
  readonly matchCount: number;
  readonly activeMatchNumber: number;
  readonly onChange: (query: string) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
}> = ({ query, matchCount, activeMatchNumber, onChange, onPrev, onNext, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.length > 0;
  const hasMatches = hasQuery && matchCount > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-1 bg-vscode-input-background hover:bg-vscode-input-background/90 shadow-lg shadow-vscode-sideBar-background/50 rounded-xl border border-vscode-panel-border/50 transition-all duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <Search size={14} className="text-vscode-descriptionForeground shrink-0" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search chat..."
        className="chat-search-input flex-1 min-w-0 bg-transparent outline-none text-sm text-vscode-foreground placeholder:text-vscode-descriptionForeground"
      />
      {hasQuery && (
        <span className="text-xs font-mono text-vscode-descriptionForeground shrink-0 tabular-nums">
          {matchCount === 0 ? 'No results' : `${activeMatchNumber}/${matchCount}`}
        </span>
      )}
      <Tooltip content="Previous match" side="bottom">
        <button onClick={onPrev} disabled={!hasMatches} className="icon-button disabled:opacity-40 disabled:cursor-default">
          <ArrowUp size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Next match" side="bottom">
        <button onClick={onNext} disabled={!hasMatches} className="icon-button disabled:opacity-40 disabled:cursor-default">
          <ArrowDown size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Close search" side="bottom">
        <button onClick={onClose} className="icon-button">
          <X size={14} />
        </button>
      </Tooltip>
    </div>
  );
};

export const ChatHeader: FC<ChatHeaderProps> = ({
  title,
  tokensIn,
  tokensOut,
  cacheWrites = 0,
  cacheReads = 0,
  totalCost,
  contextTokens,
  contextLimit,
  todos,
  onClose,
  onCompact,
  onExport,
  onDelete,
  onViewRaw,
  onArchive,
  isArchived,
  archiveDisabled,
  deleteDisabled,
  onSearchOpen,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const contextPercentage = Math.min(100, Math.round((contextTokens / contextLimit) * 100));

  const handleContainerClick = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-todo-list]')) return;
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="py-2 px-3.5 border-b border-vscode-editorGroup-border/30 bg-vscode-sideBar-background shrink-0 select-none">
      <div
        onClick={handleContainerClick}
        className="px-3 pt-2.5 pb-2 flex flex-col relative z-1 cursor-pointer bg-vscode-input-background hover:bg-vscode-input-background/90 text-vscode-foreground/80 hover:text-vscode-foreground shadow-lg shadow-vscode-sideBar-background/50 rounded-xl border border-vscode-panel-border/50 transition-all duration-200"
      >
        {/* Title Bar */}
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center grow min-w-0">
            <div className="flex items-center shrink-0 text-vscode-descriptionForeground">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            <div className="flex items-center gap-1.5 ml-1.5 grow min-w-0">
              <span className="font-bold text-xs uppercase tracking-wider text-vscode-descriptionForeground shrink-0">Task:</span>
              <Tooltip content={title.trim()} side="bottom">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis text-sm font-medium text-vscode-foreground grow min-w-0">
                  {title.trim()}
                </span>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Close task" side="bottom">
              <button onClick={onClose} className="icon-button">
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Collapsed State Summary */}
        <Accordion open={!isExpanded}>
          <div className="w-full flex items-center justify-between gap-3 mt-1.5" onClick={(e) => e.stopPropagation()}>
            <Tooltip content={`${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()}`} side="bottom">
              <div className="flex-1 flex items-center gap-2">
                <span className="text-muted whitespace-nowrap">Context: {contextPercentage}%</span>
                <ContextProgressBar percentage={contextPercentage} />
              </div>
            </Tooltip>
            <div className="flex items-center gap-2">
              {totalCost > 0 && <span className="text-xs font-mono text-vscode-foreground/80">${totalCost.toFixed(4)}</span>}
              <Tooltip content="Search chat" side="bottom">
                <button onClick={onSearchOpen} className="icon-button">
                  <Search size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        </Accordion>

        {/* Expanded Details Table */}
        <Accordion open={isExpanded}>
          <div className="flex flex-col gap-2 mt-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <table className="w-full text-muted">
              <tbody>
                {/* Context Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Context</th>
                  <td className="align-middle pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-vscode-foreground whitespace-nowrap">
                        {contextTokens.toLocaleString()} / {contextLimit.toLocaleString()} ({contextPercentage}%)
                      </span>
                      <ContextProgressBar percentage={contextPercentage} />
                      {!isArchived && (
                        <Tooltip content="Compact context">
                          <button onClick={onCompact} className="icon-button">
                            <FoldVertical size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Tokens Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Tokens</th>
                  <td className="align-middle pb-2.5 font-mono text-vscode-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <CloudUpload size={12} className="text-vscode-descriptionForeground" />
                        In: {tokensIn.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <CloudDownload size={12} className="text-vscode-descriptionForeground" />
                        Out: {tokensOut.toLocaleString()}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Cache Row */}
                {(cacheReads > 0 || cacheWrites > 0) && (
                  <tr>
                    <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Cache</th>
                    <td className="align-middle pb-2.5 font-mono text-vscode-foreground">
                      <div className="flex items-center gap-3">
                        {cacheReads > 0 && (
                          <span className="flex items-center gap-1">
                            <CloudDownload size={12} className="text-vscode-descriptionForeground opacity-60" />
                            Reads: {cacheReads.toLocaleString()}
                          </span>
                        )}
                        {cacheWrites > 0 && (
                          <span className="flex items-center gap-1">
                            <CloudUpload size={12} className="text-vscode-descriptionForeground opacity-60" />
                            Writes: {cacheWrites.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Cost & Actions Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3">API Cost</th>
                  <td className="align-middle font-mono text-vscode-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <Coins size={12} className="text-vscode-descriptionForeground" />
                        <span className="text-vscode-editorWarning-foreground font-bold">${(totalCost || 0).toFixed(4)}</span>
                        <span className="text-muted/60 font-normal">USD</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {onArchive && (
                          <Tooltip content={isArchived ? 'Unarchive task' : 'Archive task'} side="bottom">
                            <button
                              onClick={onArchive}
                              disabled={archiveDisabled}
                              className="icon-button opacity-80 hover:opacity-100 active:bg-vscode-list-hoverBackground/40 transition-opacity disabled:opacity-40 disabled:cursor-default"
                            >
                              {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                            </button>
                          </Tooltip>
                        )}
                        <TaskActions
                          iconSize={14}
                          buttonClassName="icon-button opacity-80 hover:opacity-100 active:bg-vscode-list-hoverBackground/40 transition-opacity"
                          wrapperClassName="select-none -my-1"
                          copyText={title}
                          onExport={onExport}
                          onDelete={onDelete}
                          onViewRaw={onViewRaw}
                          deleteDisabled={deleteDisabled}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Accordion>
        {todos && todos.length > 0 && <TodoView todos={todos} />}
      </div>
    </div>
  );
};
