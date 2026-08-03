import { ArrowLeft, Calendar, Check, ChevronLeft, ChevronRight, Copy, Download, FileJson, Folder, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';

import type { ComponentType, FC, MouseEvent } from 'react';
import type { HistoryItem } from '@extension/types/webview';

interface HistoryViewProps {
  readonly history: HistoryItem[];
  readonly onSelectTask: (item: HistoryItem) => void;
  readonly onDone: () => void;
  readonly onDeleteTasks: (paths: string[]) => void;
  readonly scope: 'current' | 'all';
  readonly setScope: (scope: 'current' | 'all') => void;
  readonly onViewRaw: (path: string) => void;
  readonly onExport: (item: HistoryItem) => void;
}

interface HistoryIconButtonProps {
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  readonly title: string;
  readonly onClick: (e: MouseEvent) => void;
  readonly danger?: boolean;
}

const HistoryIconButton: FC<HistoryIconButtonProps> = ({ icon: Icon, title, onClick, danger }) => {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded bg-transparent border-none cursor-pointer flex items-center transition-colors hover:bg-[var(--vscode-list-hoverBackground)] ${
        danger
          ? 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)]'
          : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
      }`}
    >
      <Icon size={12} />
    </button>
  );
};

const ITEMS_PER_PAGE = 8;

export const HistoryView: FC<HistoryViewProps> = ({ history, onSelectTask, onDone, onDeleteTasks, scope, setScope, onViewRaw, onExport }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [deleteConfirmPaths, setDeleteConfirmPaths] = useState<string[] | null>(null);

  const formatTimeAgo = (ts: number) => {
    const diffMs = Date.now() - ts;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (diffHours < 24) {
      if (diffHours === 0) return 'Just now';
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const handleCopyPrompt = (e: MouseEvent, text: string, path: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  // Filter and sort history
  const filteredHistory = useMemo(() => {
    let result = [...history];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => item.task.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return b.ts - a.ts;
      } else if (sortBy === 'oldest') {
        return a.ts - b.ts;
      } else {
        return a.task.localeCompare(b.task);
      }
    });

    return result;
  }, [history, searchQuery, sortBy]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy, scope]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / ITEMS_PER_PAGE));
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredHistory, currentPage]);

  const handleToggleSelection = (path: string) => {
    setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const handleSelectAll = () => {
    const pagePaths = paginatedItems.map((item) => item.path);
    const allSelected = pagePaths.every((p) => selectedPaths.includes(p));
    if (allSelected) {
      // Deselect all on current page
      setSelectedPaths((prev) => prev.filter((p) => !pagePaths.includes(p)));
    } else {
      // Select all on current page
      setSelectedPaths((prev) => {
        const next = [...prev];
        pagePaths.forEach((p) => {
          if (!next.includes(p)) next.push(p);
        });
        return next;
      });
    }
  };

  const handleDeleteSelected = () => {
    if (selectedPaths.length === 0) return;
    setDeleteConfirmPaths(selectedPaths);
  };

  const handleDeleteSingle = (e: MouseEvent, path: string) => {
    e.stopPropagation();
    setDeleteConfirmPaths([path]);
  };

  const handleItemClick = (item: HistoryItem) => {
    if (isSelectionMode) {
      handleToggleSelection(item.path);
    } else {
      onSelectTask(item);
    }
  };

  const isAllPageSelected = paginatedItems.length > 0 && paginatedItems.every((item) => selectedPaths.includes(item.path));

  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--vscode-panel-border)]/40 shrink-0">
        <button
          onClick={onDone}
          className="p-1 hover:bg-[var(--vscode-list-hoverBackground)] rounded cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] transition-colors border-none bg-transparent"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold text-sm text-[var(--vscode-foreground)]">Task History</span>
        <span className="ml-auto text-xs text-[var(--vscode-descriptionForeground)] font-mono">
          {filteredHistory.length} task{filteredHistory.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search and Filters Bar */}
      <div className="p-3 border-b border-[var(--vscode-panel-border)]/30 bg-[var(--vscode-editor-background)]/30 flex flex-col gap-2 shrink-0">
        {/* Search */}
        <div className="relative flex items-center w-full">
          <Search size={14} className="absolute left-2.5 text-[var(--vscode-descriptionForeground)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search task descriptions..."
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)]/60 rounded focus:border-[var(--vscode-focusBorder)] focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 p-0.5 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Scope and Sort Row */}
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="flex gap-1">
            <button
              onClick={() => setScope('current')}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors cursor-pointer border border-[var(--vscode-panel-border)]/40 ${
                scope === 'current'
                  ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                  : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
              }`}
            >
              Current Workspace
            </button>
            <button
              onClick={() => setScope('all')}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors cursor-pointer border border-[var(--vscode-panel-border)]/40 ${
                scope === 'all'
                  ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                  : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
              }`}
            >
              All Workspaces
            </button>
          </div>

          <div className="flex items-center gap-1">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'alphabetical')}
              className="px-1.5 py-0.5 text-[10px] bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded outline-none cursor-pointer"
            >
              <option value="newest">Sort: Newest</option>
              <option value="oldest">Sort: Oldest</option>
              <option value="alphabetical">Sort: A-Z</option>
            </select>

            <button
              onClick={() => setIsSelectionMode(!isSelectionMode)}
              className={`p-1.5 rounded transition-colors cursor-pointer border border-[var(--vscode-panel-border)]/40 ${
                isSelectionMode
                  ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                  : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
              }`}
              title="Select tasks"
            >
              <Check size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Selection Control Bar */}
      {isSelectionMode && (
        <div className="px-4 py-2 bg-[var(--vscode-infoBackground,var(--vscode-editor-background))]/20 border-b border-[var(--vscode-panel-border)]/30 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-[var(--vscode-textLink-foreground)] hover:underline bg-transparent border-none cursor-pointer font-medium"
            >
              {isAllPageSelected ? 'Deselect Page' : 'Select Page'}
            </button>
            <span className="text-[var(--vscode-descriptionForeground)]">|</span>
            <span className="text-[var(--vscode-foreground)] font-medium">{selectedPaths.length} selected</span>
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setSelectedPaths([]);
                setIsSelectionMode(false);
              }}
              className="px-2 py-1 bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] border border-[var(--vscode-panel-border)]/50 rounded cursor-pointer text-[var(--vscode-foreground)] font-medium text-[10px]"
            >
              Cancel
            </button>
            <button
              disabled={selectedPaths.length === 0}
              onClick={handleDeleteSelected}
              className="px-2 py-1 bg-[var(--vscode-errorForeground)]/90 hover:bg-[var(--vscode-errorForeground)] text-white border-none rounded cursor-pointer font-medium text-[10px] flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Trash2 size={10} />
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* List Container */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {paginatedItems.length > 0 ? (
          paginatedItems.map((item) => {
            const isSelected = selectedPaths.includes(item.path);
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`group flex items-start gap-3 p-3 bg-[var(--vscode-editor-background)] rounded border transition-colors cursor-pointer relative ${
                  isSelected
                    ? 'border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-hoverBackground)]/30'
                    : 'border-[var(--vscode-panel-border)]/50 hover:bg-[var(--vscode-list-hoverBackground)]'
                }`}
              >
                {isSelectionMode && (
                  <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelection(item.path)}
                      className="cursor-pointer accent-[var(--vscode-focusBorder)]"
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="text-xs leading-relaxed font-light text-[var(--vscode-foreground)] line-clamp-3">{item.task}</div>

                  <div className="flex items-center justify-between text-[10px] text-[var(--vscode-descriptionForeground)] font-medium mt-1">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={10} className="opacity-80" />
                      <span>{formatTimeAgo(item.ts)}</span>
                    </div>

                    {!isSelectionMode && (
                      <div className="flex flex-row items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <HistoryIconButton
                          icon={Download}
                          title="Export task messages"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExport(item);
                          }}
                        />
                        <HistoryIconButton
                          icon={copiedPath === item.path ? Check : Copy}
                          title={copiedPath === item.path ? 'Copied prompt!' : 'Copy prompt'}
                          onClick={(e) => handleCopyPrompt(e, item.task, item.path)}
                        />
                        <HistoryIconButton icon={Trash2} title="Delete task" danger onClick={(e) => handleDeleteSingle(e, item.path)} />
                        <HistoryIconButton
                          icon={FileJson}
                          title="View raw task"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewRaw(item.path);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--vscode-descriptionForeground)] gap-2">
            <Folder size={24} className="opacity-40" />
            <span>No task history found</span>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="px-4 pt-2 pb-3.5 border-t border-[var(--vscode-panel-border)]/40 bg-[var(--vscode-editor-background)]/20 flex items-center justify-between shrink-0 select-none">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="p-1 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-40 disabled:pointer-events-none rounded cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="text-[10px] font-medium text-[var(--vscode-descriptionForeground)]">
            Page {currentPage} of {totalPages}
          </span>

          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="p-1 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-40 disabled:pointer-events-none rounded cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirmPaths !== null}
        title={deleteConfirmPaths && deleteConfirmPaths.length > 1 ? 'Delete Tasks' : 'Delete Task'}
        description={
          deleteConfirmPaths && deleteConfirmPaths.length > 1
            ? `Are you sure you want to delete ${deleteConfirmPaths.length} selected tasks?`
            : 'Are you sure you want to delete this task?'
        }
        onConfirm={() => {
          if (deleteConfirmPaths) {
            onDeleteTasks(deleteConfirmPaths);
            const deletedPathsSet = new Set(deleteConfirmPaths);
            setSelectedPaths((prev) => prev.filter((p) => !deletedPathsSet.has(p)));
            if (deleteConfirmPaths.length > 1) {
              setIsSelectionMode(false);
            }
          }
          setDeleteConfirmPaths(null);
        }}
        onCancel={() => setDeleteConfirmPaths(null)}
      />
    </div>
  );
};
