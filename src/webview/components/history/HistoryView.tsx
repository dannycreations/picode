import { ArrowLeft, Folder } from 'lucide-react';
import { useCallback, useState } from 'react';

import { HistoryCard } from '@extension/webview/components/history/HistoryCard';
import { HistoryFilter } from '@extension/webview/components/history/HistoryFilter';
import { HistoryPagination } from '@extension/webview/components/history/HistoryPagination';
import { HistorySelection } from '@extension/webview/components/history/HistorySelection';
import { useCopyPrompt } from '@extension/webview/components/history/hooks/useCopyPrompt';
import { useHistoryFilter } from '@extension/webview/components/history/hooks/useHistoryFilter';
import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';

import type { FC, MouseEvent } from 'react';
import type { HistoryItem } from '@extension/types/webview';
import type { HistoryScope } from '@extension/webview/components/history/hooks/useHistoryFilter';

interface HistoryViewProps {
  readonly history: HistoryItem[];
  readonly onSelectTask: (item: HistoryItem) => void;
  readonly onDone: () => void;
  readonly onDeleteTasks: (paths: string[]) => void;
  readonly scope: HistoryScope;
  readonly setScope: (scope: HistoryScope) => void;
  readonly onViewRaw: (path: string) => void;
  readonly onExport: (item: HistoryItem) => void;
}

const ITEMS_PER_PAGE = 8;

export const HistoryView: FC<HistoryViewProps> = ({ history, onSelectTask, onDone, onDeleteTasks, scope, setScope, onViewRaw, onExport }) => {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [deleteConfirmPaths, setDeleteConfirmPaths] = useState<string[] | null>(null);

  const { copiedPath, copyToClipboard } = useCopyPrompt();
  const { searchQuery, setSearchQuery, sortBy, setSortBy, currentPage, setCurrentPage, totalPages, filteredHistory, paginatedItems } =
    useHistoryFilter(history, ITEMS_PER_PAGE, scope);

  // Selection handlers
  const handleToggleSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }, []);

  const handleSelectAllPage = useCallback(() => {
    const pagePaths = paginatedItems.map((item) => item.path);
    const allSelected = pagePaths.every((p) => selectedPaths.includes(p));

    if (allSelected) {
      setSelectedPaths((prev) => prev.filter((p) => !pagePaths.includes(p)));
    } else {
      setSelectedPaths((prev) => Array.from(new Set([...prev, ...pagePaths])));
    }
  }, [paginatedItems, selectedPaths]);

  const handleDeleteSingle = useCallback((e: MouseEvent, path: string) => {
    e.stopPropagation();
    setDeleteConfirmPaths([path]);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirmPaths) {
      onDeleteTasks(deleteConfirmPaths);
      const deletedPathsSet = new Set(deleteConfirmPaths);
      setSelectedPaths((prev) => prev.filter((p) => !deletedPathsSet.has(p)));
      if (deleteConfirmPaths.length > 1) {
        setIsSelectionMode(false);
      }
    }
    setDeleteConfirmPaths(null);
  }, [deleteConfirmPaths, onDeleteTasks]);

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

      {/* Filter Bar */}
      <HistoryFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        scope={scope}
        onScopeChange={setScope}
        sortBy={sortBy}
        onSortChange={setSortBy}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={() => setIsSelectionMode((prev) => !prev)}
      />

      {/* Selection Bar */}
      {isSelectionMode && (
        <HistorySelection
          selectedCount={selectedPaths.length}
          isAllPageSelected={isAllPageSelected}
          onSelectAll={handleSelectAllPage}
          onCancel={() => {
            setSelectedPaths([]);
            setIsSelectionMode(false);
          }}
          onDeleteSelected={() => setDeleteConfirmPaths(selectedPaths)}
        />
      )}

      {/* List Container */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {paginatedItems.length > 0 ? (
          paginatedItems.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              isSelected={selectedPaths.includes(item.path)}
              isSelectionMode={isSelectionMode}
              copiedPath={copiedPath}
              onClick={() => (isSelectionMode ? handleToggleSelection(item.path) : onSelectTask(item))}
              onToggleSelect={handleToggleSelection}
              onCopy={copyToClipboard}
              onDelete={handleDeleteSingle}
              onViewRaw={onViewRaw}
              onExport={onExport}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--vscode-descriptionForeground)] gap-2">
            <Folder size={24} className="opacity-40" />
            <span>No task history found</span>
          </div>
        )}
      </div>

      {/* Pagination Bar */}
      <HistoryPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmPaths !== null}
        title={deleteConfirmPaths && deleteConfirmPaths.length > 1 ? 'Delete Tasks' : 'Delete Task'}
        description={
          deleteConfirmPaths && deleteConfirmPaths.length > 1
            ? `Are you sure you want to delete ${deleteConfirmPaths.length} selected tasks?`
            : 'Are you sure you want to delete this task?'
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmPaths(null)}
      />
    </div>
  );
};
