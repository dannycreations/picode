import { ArrowLeft, Folder } from 'lucide-react';
import { useCallback, useState } from 'react';

import { HistoryCard } from '@pi-code/webview/components/history/HistoryCard';
import { HistoryFilter } from '@pi-code/webview/components/history/HistoryFilter';
import { HistoryPagination } from '@pi-code/webview/components/history/HistoryPagination';
import { HistorySelection } from '@pi-code/webview/components/history/HistorySelection';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { Dispatch, FC, SetStateAction } from 'react';
import type { HistoryItem, HistoryScope } from '@pi-code/shared/core/protocol';
import type { UseHistoryFilterReturn } from '@pi-code/webview/components/history/hooks/useHistoryFilter';

interface HistoryViewProps {
  readonly filter: UseHistoryFilterReturn;
  readonly onSelectTask: (item: HistoryItem) => void;
  readonly onDone: () => void;
  readonly onDeleteTasks: (paths: string[]) => void;
  readonly scope: HistoryScope;
  readonly setScope: (scope: HistoryScope) => void;
  readonly onViewRaw: (path: string) => void;
  readonly onExport: (item: HistoryItem) => void;
  readonly isSelectionMode: boolean;
  readonly setIsSelectionMode: Dispatch<SetStateAction<boolean>>;
  readonly selectedPaths: string[];
  readonly setSelectedPaths: Dispatch<SetStateAction<string[]>>;
}

export const HistoryView: FC<HistoryViewProps> = ({
  filter,
  onSelectTask,
  onDone,
  onDeleteTasks,
  scope,
  setScope,
  onViewRaw,
  onExport,
  isSelectionMode,
  setIsSelectionMode,
  selectedPaths,
  setSelectedPaths,
}) => {
  const [deleteConfirmPaths, setDeleteConfirmPaths] = useState<string[] | null>(null);

  const { searchQuery, setSearchQuery, sortBy, setSortBy, currentPage, setCurrentPage, totalPages, filteredHistory, paginatedItems } = filter;

  const onToggleSelectionMode = useCallback(() => setIsSelectionMode((prev) => !prev), [setIsSelectionMode]);

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

  const handleDeleteSingle = useCallback((path: string) => {
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
  }, [deleteConfirmPaths, onDeleteTasks, setSelectedPaths, setIsSelectionMode]);

  const isAllPageSelected = paginatedItems.length > 0 && paginatedItems.every((item) => selectedPaths.includes(item.path));

  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-vscode-panel-border/40 shrink-0">
        <Tooltip content="Back to chat" side="bottom">
          <button onClick={onDone} className="icon-button transition-colors">
            <ArrowLeft size={16} />
          </button>
        </Tooltip>
        <span className="font-semibold text-sm text-vscode-foreground">Task History</span>
        <span className="ml-auto text-muted font-mono">
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
        onToggleSelectionMode={onToggleSelectionMode}
      />

      {/* Selection Bar */}
      <Accordion open={isSelectionMode} className="shrink-0">
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
      </Accordion>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {paginatedItems.length > 0 ? (
          paginatedItems.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              isSelected={selectedPaths.includes(item.path)}
              isSelectionMode={isSelectionMode}
              onClick={() => (isSelectionMode ? handleToggleSelection(item.path) : onSelectTask(item))}
              onToggleSelect={handleToggleSelection}
              onDelete={handleDeleteSingle}
              onViewRaw={onViewRaw}
              onExport={onExport}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted gap-2">
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
